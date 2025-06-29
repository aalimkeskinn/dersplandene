import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

/**
 * "Öncelikli Kısıtlı Görev" Algoritması (v47 - Sınıf Öğretmeni Önceliği ve Dağıtım Şekli İyileştirilmiş)
 * 1. Sınıf öğretmenlerinin derslerini öncelikli olarak yerleştirir (İlkokul ve Anaokulu için)
 * 2. Sınıf öğretmenlerinin dersleri tamamlanmadan diğer dersler yerleştirilmez
 * 3. Bir gün içinde sınıf öğretmeni 4 saate kadar ders verebilir (2 farklı ders, 2'şer saat)
 * 4. "KULÜP" derslerini sabit zaman dilimlerinde 2 saatlik bloklar halinde yerleştirir
 * 5. "ADE" gibi özel dersleri tespit eder ve kısıtlamalarına göre yerleştirir
 * 6. Yemek saatlerine ders atanmasını engeller
 * 7. Bir öğretmenin aynı sınıfa günde en fazla 4 saat ders vermesini sağlar (sınıf öğretmenleri için)
 * 8. Her sınıfın 45 saatlik ders ile doldurulmasını hedefler
 * 9. Ardından kalan normal dersleri, boş kalan slotlara en verimli şekilde dağıtır
 * 10. Öğretmenlerin haftalık ders saati limitlerini dikkate alır
 * 11. Derslerin dağıtım şekillerini (2+2+2 gibi) dikkate alır
 */
export function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules']
): EnhancedGenerationResult {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v47 - Sınıf Öğretmeni Önceliği ve Dağıtım Şekli İyileştirilmiş)...');

  // --- AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();
  
  // YENİ: Öğretmen-sınıf günlük ders saati takibi
  const teacherClassDailyHours = new Map<string, Map<string, Map<string, number>>>();
  
  // YENİ: Öğretmen-sınıf-ders günlük ders saati takibi
  const teacherClassSubjectDailyHours = new Map<string, Map<string, Map<string, Map<string, number>>>>();

  const teacherLevelTargets = new Map<string, Map<string, number>>();
  mappings.forEach(m => {
      const classItem = allClasses.find(c => c.id === m.classId);
      if (!classItem) return;
      const level = getEntityLevel(classItem);
      if (!teacherLevelTargets.has(m.teacherId)) teacherLevelTargets.set(m.teacherId, new Map<string, number>());
      const levelMap = teacherLevelTargets.get(m.teacherId)!;
      levelMap.set(level, (levelMap.get(level) || 0) + m.weeklyHours);
  });
  
  const teacherLevelActualHours = new Map<string, Map<string, number>>();
  teacherLevelTargets.forEach((levelMap, teacherId) => {
      const newLevelMap = new Map<string, number>();
      levelMap.forEach((_, level) => newLevelMap.set(level, 0));
      teacherLevelActualHours.set(teacherId, newLevelMap);
  });

  timeConstraints.forEach(c => { if (c.constraintType) constraintMap.set(`${c.entityType}-${c.entityId}-${c.day}-${c.period}`, c.constraintType); });

  const selectedClassIds = new Set(mappings.map(m => m.classId));
  selectedClassIds.forEach(classId => {
    const classItem = allClasses.find(c => c.id === classId)!;
    if (classItem) {
      classScheduleGrids[classId] = {};
      classAvailability.set(classId, new Set<string>());
      DAYS.forEach(day => { classScheduleGrids[classId][day] = {}; });
      
      // YEMEK SAATLERİNİ DOLDUR VE MEŞGUL OLARAK İŞARETLE
      const lunchPeriod = getEntityLevel(classItem) === 'Ortaokul' ? '6' : '5';
      if (PERIODS.includes(lunchPeriod)) {
        DAYS.forEach(day => { 
          classScheduleGrids[classId][day][lunchPeriod] = { 
            isFixed: true, 
            classId: 'fixed-period', 
            subjectId: 'fixed-lunch' 
          }; 
          classAvailability.get(classId)!.add(`${day}-${lunchPeriod}`); 
        });
      }
    }
  });

  const selectedTeacherIds = new Set(mappings.map(m => m.teacherId));
  selectedTeacherIds.forEach(teacherId => { 
    teacherAvailability.set(teacherId, new Set<string>()); 
    
    // YENİ: Öğretmen-sınıf günlük ders saati takibi için veri yapısı oluştur
    teacherClassDailyHours.set(teacherId, new Map<string, Map<string, number>>());
    teacherClassSubjectDailyHours.set(teacherId, new Map<string, Map<string, Map<string, number>>>());
    
    DAYS.forEach(day => {
      if (!teacherClassDailyHours.get(teacherId)!.has(day)) {
        teacherClassDailyHours.get(teacherId)!.set(day, new Map<string, number>());
      }
      
      if (!teacherClassSubjectDailyHours.get(teacherId)!.has(day)) {
        teacherClassSubjectDailyHours.get(teacherId)!.set(day, new Map<string, Map<string, number>>());
      }
    });
    
    // ÖĞRETMENLER İÇİN DE YEMEK SAATLERİNİ MEŞGUL OLARAK İŞARETLE
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (teacher) {
      const teacherLevel = getEntityLevel(teacher);
      const lunchPeriod = teacherLevel === 'Ortaokul' ? '6' : '5';
      
      if (PERIODS.includes(lunchPeriod)) {
        DAYS.forEach(day => {
          teacherAvailability.get(teacherId)!.add(`${day}-${lunchPeriod}`);
        });
      }
    }
  });
  
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    classLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul'; 
    isPlaced: boolean; 
    isSpecial: boolean;
    isKulupDersi?: boolean;
    isClassTeacherTask?: boolean; // YENİ: Sınıf öğretmeni görevi mi?
    isMainSubject?: boolean; // YENİ: Temel ders mi? (Türkçe, Matematik)
    fixedSlots?: {day: string, period: string}[];
    distributionDay?: number; // YENİ: Dağıtım şekli için gün indeksi
  };
  
  let specialTasks: PlacementTask[] = [];
  let classTeacherTasks: PlacementTask[] = []; // YENİ: Sınıf öğretmeni görevleri
  let normalTasks: PlacementTask[] = [];

  // YENİ: Önce sınıf öğretmeni görevlerini belirle
  mappings.forEach(mapping => {
    const classItem = allClasses.find(c => c.id === mapping.classId)!;
    const subject = allSubjects.find(s => s.id === mapping.subjectId)!;
    const classLevel = getEntityLevel(classItem);
    const distribution = mapping.distribution || [];
    
    // Sınıf öğretmeni görevi mi kontrol et
    const isClassTeacherTask = classItem.classTeacherId === mapping.teacherId;
    
    // Temel ders mi kontrol et (Türkçe, Matematik, Hayat Bilgisi)
    const isMainSubject = subject.name.includes('Türkçe') || 
                          subject.name.includes('Matematik') || 
                          subject.name.includes('Hayat Bilgisi');
    
    // KULÜP DERSLERİ İÇİN ÖZEL KONTROL
    const isKulupDersi = subject.name.toUpperCase().includes('KULÜP');
    const isADEDersi = subject.name.toUpperCase().includes('ADE');
    const isSpecial = isKulupDersi || isADEDersi;
    const hasSpecificConstraints = timeConstraints.some(c => c.entityType === 'subject' && c.entityId === subject.id);

    // Kulüp dersleri için özel işlem
    if (isKulupDersi) {
      // İlkokul kulüp dersleri Perşembe 9-10. ders saatlerinde
      if (classLevel === 'İlkokul' || classLevel === 'Anaokulu') {
        specialTasks.push({ 
          mapping, 
          blockLength: 2, // 2 saatlik blok
          taskId: `${mapping.id}-kulup-ilkokul`, 
          classLevel, 
          isPlaced: false,
          isSpecial: true,
          isKulupDersi: true,
          isClassTeacherTask,
          isMainSubject,
          fixedSlots: [
            { day: 'Perşembe', period: '9' },
            { day: 'Perşembe', period: '10' }
          ]
        });
      }
      // Ortaokul kulüp dersleri Perşembe 7-8. ders saatlerinde
      else if (classLevel === 'Ortaokul') {
        specialTasks.push({ 
          mapping, 
          blockLength: 2, // 2 saatlik blok
          taskId: `${mapping.id}-kulup-ortaokul`, 
          classLevel, 
          isPlaced: false,
          isSpecial: true,
          isKulupDersi: true,
          isClassTeacherTask,
          isMainSubject,
          fixedSlots: [
            { day: 'Perşembe', period: '7' },
            { day: 'Perşembe', period: '8' }
          ]
        });
      }
    }
    // ADE dersleri için özel işlem
    else if (isADEDersi && hasSpecificConstraints) {
      for(let i=0; i<mapping.weeklyHours; i++){
        specialTasks.push({ 
          mapping, 
          blockLength: 1, 
          taskId: `${mapping.id}-ade-${i}`, 
          classLevel, 
          isPlaced: false,
          isSpecial: true,
          isClassTeacherTask,
          isMainSubject
        });
      }
    }
    // Sınıf öğretmeni görevleri
    else if (isClassTeacherTask && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) {
      // Eğer dağıtım şekli belirtilmişse, ona göre yerleştir
      if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
          classTeacherTasks.push({ 
            mapping, 
            blockLength: block, 
            taskId: `${mapping.id}-class-teacher-${index}`, 
            classLevel, 
            isPlaced: false,
            isSpecial: false,
            isClassTeacherTask: true,
            isMainSubject,
            distributionDay: index // YENİ: Dağıtım şekli için gün indeksi
          });
        });
      } else {
        // Dağıtım şekli belirtilmemişse, 2 saatlik bloklara böl
        let hoursLeft = mapping.weeklyHours;
        while (hoursLeft >= 2) {
          classTeacherTasks.push({ 
            mapping, 
            blockLength: 2, 
            taskId: `${mapping.id}-class-teacher-block-${hoursLeft}`, 
            classLevel, 
            isPlaced: false,
            isSpecial: false,
            isClassTeacherTask: true,
            isMainSubject
          });
          hoursLeft -= 2;
        }
        
        // Kalan tek saatleri ekle
        for (let i = 0; i < hoursLeft; i++) {
          classTeacherTasks.push({ 
            mapping, 
            blockLength: 1, 
            taskId: `${mapping.id}-class-teacher-single-${i}`, 
            classLevel, 
            isPlaced: false,
            isSpecial: false,
            isClassTeacherTask: true,
            isMainSubject
          });
        }
      }
    }
    // Normal dersler
    else {
      let hoursLeft = mapping.weeklyHours;
      if (distribution.length > 0 && globalRules.useDistributionPatterns) {
        distribution.forEach((block, index) => {
          normalTasks.push({ 
            mapping, 
            blockLength: block, 
            taskId: `${mapping.id}-dist-${index}`, 
            classLevel, 
            isPlaced: false,
            isSpecial: false,
            isClassTeacherTask,
            isMainSubject,
            distributionDay: index // YENİ: Dağıtım şekli için gün indeksi
          });
          hoursLeft -= block;
        });
      }
      for (let i = 0; i < hoursLeft; i++) {
        normalTasks.push({ 
          mapping, 
          blockLength: 1, 
          taskId: `${mapping.id}-single-${i}`, 
          classLevel, 
          isPlaced: false,
          isSpecial: false,
          isClassTeacherTask,
          isMainSubject
        });
      }
    }
  });
  
  // --- AŞAMA 2: KULÜP DERSLERİNİ SABİT ZAMAN DİLİMLERİNE YERLEŞTİR ---
  console.log(`--- 1. Aşama: Kulüp Dersleri (${specialTasks.filter(t => t.isKulupDersi).length} adet) Yerleştiriliyor... ---`);
  
  // Önce kulüp derslerini yerleştir
  const kulupTasks = specialTasks.filter(t => t.isKulupDersi);
  for (const task of kulupTasks) {
    const { mapping, classLevel, fixedSlots } = task;
    const { teacherId, classId, subjectId } = mapping;
    
    if (!fixedSlots || fixedSlots.length === 0) continue;
    
    // Kulüp derslerini sabit slotlara yerleştir
    let allSlotsAvailable = true;
    
    // Önce tüm slotların müsait olup olmadığını kontrol et
    for (const slot of fixedSlots) {
      const slotKey = `${slot.day}-${slot.period}`;
      if (teacherAvailability.get(teacherId)?.has(slotKey) || 
          classAvailability.get(classId)?.has(slotKey)) {
        allSlotsAvailable = false;
        break;
      }
    }
    
    // Eğer tüm slotlar müsaitse, yerleştir
    if (allSlotsAvailable) {
      for (const slot of fixedSlots) {
        const slotKey = `${slot.day}-${slot.period}`;
        
        // Programı güncelle
        classScheduleGrids[classId][slot.day][slot.period] = { 
          subjectId, 
          teacherId, 
          classId, 
          isFixed: false // DÜZELTME: Kulüp dersleri normal ders olarak işaretlenir
        };
        
        // Müsaitlik durumlarını güncelle
        teacherAvailability.get(teacherId)!.add(slotKey);
        classAvailability.get(classId)!.add(slotKey);
        
        // Ders saati sayacını güncelle
        const currentHours = teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0;
        teacherLevelActualHours.get(teacherId)?.set(classLevel, currentHours + 1);
        
        // YENİ: Öğretmen-sınıf günlük ders saati takibini güncelle
        const day = slot.day;
        if (!teacherClassDailyHours.get(teacherId)!.get(day)!.has(classId)) {
          teacherClassDailyHours.get(teacherId)!.get(day)!.set(classId, 0);
        }
        teacherClassDailyHours.get(teacherId)!.get(day)!.set(
          classId, 
          (teacherClassDailyHours.get(teacherId)!.get(day)!.get(classId) || 0) + 1
        );
        
        // YENİ: Öğretmen-sınıf-ders günlük ders saati takibini güncelle
        if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.has(classId)) {
          teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.set(classId, new Map<string, number>());
        }
        if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.has(subjectId)) {
          teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(subjectId, 0);
        }
        teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(
          subjectId,
          (teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.get(subjectId) || 0) + 1
        );
      }
      
      task.isPlaced = true;
      console.log(`✅ ${classLevel} Kulüp dersi yerleştirildi: ${fixedSlots.map(s => `${s.day} ${s.period}`).join(', ')}`);
    } else {
      console.log(`⚠️ ${classLevel} Kulüp dersi için uygun slot bulunamadı`);
    }
  }
  
  // --- AŞAMA 3: DİĞER ÖZEL GÖREVLERİ YERLEŞTİR ---
  console.log(`--- 2. Aşama: Diğer Özel Görevler (${specialTasks.filter(t => !t.isKulupDersi).length} adet) Yerleştiriliyor... ---`);
  
  // Kulüp dersleri dışındaki özel görevleri yerleştir
  const otherSpecialTasks = specialTasks.filter(t => !t.isKulupDersi && !t.isPlaced);
  otherSpecialTasks.sort((a,b) => LEVEL_ORDER[a.classLevel] - LEVEL_ORDER[b.classLevel]);

  for (const task of otherSpecialTasks) {
    const { mapping, classLevel } = task;
    const { teacherId, classId, subjectId } = mapping;
    
    // ADE dersleri veya diğer özel dersler için kısıtlamaları kontrol et
    let preferredSlots: {day: string, period: string}[] = [];
    timeConstraints.forEach(c => {
      if (c.entityType === 'subject' && c.entityId === subjectId && c.constraintType === 'preferred') {
        preferredSlots.push({ day: c.day, period: c.period });
      }
    });

    // Eğer tercih edilen slotlar belirlenmediyse, tüm slotları dene
    if (preferredSlots.length === 0) {
      DAYS.forEach(day => {
        PERIODS.forEach(period => {
          // YEMEK SAATLERİNİ ATLA
          const lunchPeriod = classLevel === 'Ortaokul' ? '6' : '5';
          if (period !== lunchPeriod) {
            preferredSlots.push({ day, period });
          }
        });
      });
    }

    let placed = false;
    for (const slot of preferredSlots) {
      const slotKey = `${slot.day}-${slot.period}`;
      const isTeacherUnavailable = constraintMap.get(`teacher-${teacherId}-${slot.day}-${slot.period}`) === 'unavailable';
      const isAvailable = !teacherAvailability.get(teacherId)?.has(slotKey) && 
                          !classAvailability.get(classId)?.has(slotKey) && 
                          !isTeacherUnavailable;
      
      // YENİ: Öğretmenin bu sınıfa bu gün için ders saati limitini kontrol et
      const teacherDailyHoursForClass = teacherClassDailyHours.get(teacherId)?.get(slot.day)?.get(classId) || 0;
      const maxDailyHours = task.isClassTeacherTask ? 4 : 2; // Sınıf öğretmenleri için 4, diğerleri için 2
      
      if (teacherDailyHoursForClass >= maxDailyHours) {
        // Bu öğretmen bu sınıfa bu gün için maksimum ders saatine ulaşmış
        continue;
      }
      
      // YENİ: Öğretmenin toplam ders saati limitini kontrol et
      const teacher = allTeachers.find(t => t.id === teacherId);
      if (teacher) {
        const currentTeacherTotalHours = Array.from(teacherLevelActualHours.get(teacherId)?.values() || []).reduce((sum, hours) => sum + hours, 0);
        const teacherMaxHours = teacher.totalWeeklyHours || 45; // Öğretmenin belirtilen maksimum saati veya varsayılan 45
        
        if (currentTeacherTotalHours + 1 > teacherMaxHours) {
          console.warn(`UYARI: ${teacher.name} öğretmeni maksimum ders saatine (${teacherMaxHours}) ulaştı. Şu anki: ${currentTeacherTotalHours}, Eklenecek: 1`);
          task.isPlaced = false;
          break;
        }
      }
      
      if (isAvailable) {
        classScheduleGrids[classId][slot.day][slot.period] = { 
          subjectId, 
          teacherId, 
          classId, 
          isFixed: false 
        };
        teacherAvailability.get(teacherId)!.add(slotKey);
        classAvailability.get(classId)!.add(slotKey);
        const currentHours = teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0;
        teacherLevelActualHours.get(teacherId)?.set(classLevel, currentHours + 1);
        
        // YENİ: Öğretmen-sınıf günlük ders saati takibini güncelle
        const day = slot.day;
        if (!teacherClassDailyHours.get(teacherId)!.get(day)!.has(classId)) {
          teacherClassDailyHours.get(teacherId)!.get(day)!.set(classId, 0);
        }
        teacherClassDailyHours.get(teacherId)!.get(day)!.set(
          classId, 
          (teacherClassDailyHours.get(teacherId)!.get(day)!.get(classId) || 0) + 1
        );
        
        // YENİ: Öğretmen-sınıf-ders günlük ders saati takibini güncelle
        if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.has(classId)) {
          teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.set(classId, new Map<string, number>());
        }
        if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.has(subjectId)) {
          teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(subjectId, 0);
        }
        teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(
          subjectId,
          (teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.get(subjectId) || 0) + 1
        );
        
        placed = true;
        task.isPlaced = true;
        break;
      }
    }
  }

  // --- AŞAMA 3.5: SINIF ÖĞRETMENİ GÖREVLERİNİ YERLEŞTİR ---
  console.log(`--- 3. Aşama: Sınıf Öğretmeni Görevleri (${classTeacherTasks.length} adet) Yerleştiriliyor... ---`);
  
  // Önce temel dersleri (Türkçe, Matematik) yerleştir
  classTeacherTasks.sort((a, b) => {
    // Önce temel dersler
    if (a.isMainSubject && !b.isMainSubject) return -1;
    if (!a.isMainSubject && b.isMainSubject) return 1;
    
    // Sonra blok uzunluğuna göre
    return b.blockLength - a.blockLength;
  });
  
  // Sınıf öğretmeni görevlerini yerleştir
  for (const task of classTeacherTasks) {
    const { mapping, blockLength, classLevel, isMainSubject, distributionDay } = task;
    const { teacherId, classId, subjectId } = mapping;
    
    const teacher = allTeachers.find(t => t.id === teacherId)!;
    const classItem = allClasses.find(c => c.id === classId)!;
    const subject = allSubjects.find(s => s.id === subjectId)!;
    
    console.log(`🔍 Sınıf öğretmeni görevi: ${teacher.name} → ${classItem.name} → ${subject.name} (${blockLength} saat)${isMainSubject ? ' [Temel Ders]' : ''}`);
    
    // YENİ: Öğretmenin toplam ders saati limitini kontrol et
    const currentTeacherTotalHours = Array.from(teacherLevelActualHours.get(teacherId)?.values() || []).reduce((sum, hours) => sum + hours, 0);
    const teacherMaxHours = teacher.totalWeeklyHours || 45; // Öğretmenin belirtilen maksimum saati veya varsayılan 45
    
    if (currentTeacherTotalHours + blockLength > teacherMaxHours) {
      console.warn(`UYARI: ${teacher.name} öğretmeni maksimum ders saatine (${teacherMaxHours}) ulaştı. Şu anki: ${currentTeacherTotalHours}, Eklenecek: ${blockLength}`);
      task.isPlaced = false;
      continue;
    }
    
    // Temel dersleri (Türkçe, Matematik) sabah saatlerine yerleştirmeye çalış
    const preferredPeriods = isMainSubject ? ['1', '2', '3', '4'] : PERIODS;
    
    let placed = false;
    
    // YENİ: Dağıtım şekli için belirli bir gün belirtilmişse, o günü önceliklendir
    let daysByPriority = [...DAYS];
    if (distributionDay !== undefined && distributionDay >= 0 && distributionDay < DAYS.length) {
      // Belirtilen günü en başa al
      const specificDay = DAYS[distributionDay];
      daysByPriority = [specificDay, ...DAYS.filter(d => d !== specificDay)];
    } else {
      // Günleri dengeli dağıtmak için, önce az ders olan günleri dene
      daysByPriority = [...DAYS].sort((a, b) => {
        const aLoad = teacherClassDailyHours.get(teacherId)?.get(a)?.get(classId) || 0;
        const bLoad = teacherClassDailyHours.get(teacherId)?.get(b)?.get(classId) || 0;
        return aLoad - bLoad;
      });
    }
    
    for (const day of daysByPriority) {
      // YENİ: Öğretmenin bu sınıfa bu gün için ders saati limitini kontrol et
      const teacherDailyHoursForClass = teacherClassDailyHours.get(teacherId)?.get(day)?.get(classId) || 0;
      const maxDailyHours = 4; // Sınıf öğretmenleri için 4 saat limit
      
      if (teacherDailyHoursForClass >= maxDailyHours) {
        // Bu öğretmen bu sınıfa bu gün için maksimum ders saatine ulaşmış
        continue;
      }
      
      // YENİ: Öğretmenin bu sınıfa bu gün için bu dersten kaç saat verdiğini kontrol et
      const teacherDailyHoursForSubject = teacherClassSubjectDailyHours.get(teacherId)?.get(day)?.get(classId)?.get(subjectId) || 0;
      const maxDailyHoursPerSubject = 2; // Bir dersten günde en fazla 2 saat
      
      if (teacherDailyHoursForSubject >= maxDailyHoursPerSubject) {
        // Bu öğretmen bu sınıfa bu gün için bu dersten maksimum saate ulaşmış
        continue;
      }
      
      // YENİ: Sınıfın toplam ders saati kontrolü (45 saat limiti)
      let classWeeklyHours = 0;
      DAYS.forEach(d => {
        PERIODS.forEach(p => {
          if (classScheduleGrids[classId][d][p] && !classScheduleGrids[classId][d][p].isFixed) {
            classWeeklyHours++;
          }
        });
      });
      
      if (classWeeklyHours >= 45) {
        console.warn(`UYARI: ${classItem.name} sınıfı maksimum haftalık ders saatine (45) ulaştı.`);
        task.isPlaced = false;
        break;
      }
      
      // Eğer öğretmen bu sınıfa bu gün için kalan ders saati, blok uzunluğundan azsa,
      // bloğu böl ve yerleştirilebilecek kadar yerleştir
      const remainingDailyHours = maxDailyHours - teacherDailyHoursForClass;
      const remainingDailyHoursForSubject = maxDailyHoursPerSubject - teacherDailyHoursForSubject;
      
      if (remainingDailyHours < blockLength || remainingDailyHoursForSubject < blockLength) {
        // Bloğu böl
        const placeable = Math.min(remainingDailyHours, remainingDailyHoursForSubject);
        
        if (placeable > 0 && blockLength > placeable) {
          // Yerleştirilebilecek kısmı yerleştir
          classTeacherTasks.push({ 
            ...task,
            blockLength: placeable,
            taskId: `${task.taskId}-split-daily-limit-placeable`
          });
          
          // Kalan kısmı başka bir görev olarak ekle
          classTeacherTasks.push({ 
            ...task,
            blockLength: blockLength - placeable,
            taskId: `${task.taskId}-split-daily-limit-remaining`
          });
          
          // Mevcut görevi atla
          task.isPlaced = false;
          break;
        }
      }
      
      // Tercih edilen periyotları dene
      for (let i = 0; i <= preferredPeriods.length - blockLength; i++) {
        let isAvailable = true;
        for (let j = 0; j < blockLength; j++) {
          const period = preferredPeriods[i+j];
          const slotKey = `${day}-${period}`;
          
          // YEMEK SAATLERİNİ KONTROL ET
          const lunchPeriod = classLevel === 'Ortaokul' ? '6' : '5';
          if (period === lunchPeriod) {
            isAvailable = false;
            break;
          }
          
          if (teacherAvailability.get(teacherId)?.has(slotKey) || 
              classAvailability.get(classId)?.has(slotKey) || 
              constraintMap.get(`subject-${subjectId}-${day}-${period}`) === 'unavailable' || 
              constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
              constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
            isAvailable = false;
            break;
          }
        }
        
        if (isAvailable) {
          for (let j = 0; j < blockLength; j++) {
            const period = preferredPeriods[i + j];
            const slotKey = `${day}-${period}`;
            classScheduleGrids[classId][day][period] = { 
              subjectId, 
              teacherId, 
              classId, 
              isFixed: false 
            };
            teacherAvailability.get(teacherId)!.add(slotKey);
            classAvailability.get(classId)!.add(slotKey);
            
            // YENİ: Öğretmen-sınıf günlük ders saati takibini güncelle
            if (!teacherClassDailyHours.get(teacherId)!.get(day)!.has(classId)) {
              teacherClassDailyHours.get(teacherId)!.get(day)!.set(classId, 0);
            }
            teacherClassDailyHours.get(teacherId)!.get(day)!.set(
              classId, 
              (teacherClassDailyHours.get(teacherId)!.get(day)!.get(classId) || 0) + 1
            );
            
            // YENİ: Öğretmen-sınıf-ders günlük ders saati takibini güncelle
            if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.has(classId)) {
              teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.set(classId, new Map<string, number>());
            }
            if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.has(subjectId)) {
              teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(subjectId, 0);
            }
            teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(
              subjectId,
              (teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.get(subjectId) || 0) + 1
            );
          }
          teacherLevelActualHours.get(teacherId)?.set(classLevel, (teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0) + blockLength);
          placed = true;
          task.isPlaced = true;
          console.log(`✅ Sınıf öğretmeni dersi yerleştirildi: ${teacher.name} → ${classItem.name} → ${subject.name} (${day}, ${blockLength} saat)${isMainSubject ? ' [Temel Ders]' : ''}`);
          break;
        }
      }
      
      if (placed) break;
    }
    
    // Eğer yerleştirilemezse ve blok uzunluğu 1'den büyükse, bloğu böl
    if (!placed && blockLength > 1) {
      // Bloğu iki parçaya böl
      const firstBlockLength = Math.ceil(blockLength / 2);
      const secondBlockLength = blockLength - firstBlockLength;
      
      // İlk parça
      classTeacherTasks.push({ 
        mapping, 
        blockLength: firstBlockLength, 
        taskId: `${task.taskId}-split-1`, 
        classLevel, 
        isPlaced: false,
        isSpecial: false,
        isClassTeacherTask: true,
        isMainSubject
      });
      
      // İkinci parça
      if (secondBlockLength > 0) {
        classTeacherTasks.push({ 
          mapping, 
          blockLength: secondBlockLength, 
          taskId: `${task.taskId}-split-2`, 
          classLevel, 
          isPlaced: false,
          isSpecial: false,
          isClassTeacherTask: true,
          isMainSubject
        });
      }
      
      // Yeniden sırala
      classTeacherTasks.sort((a, b) => {
        // Önce temel dersler
        if (a.isMainSubject && !b.isMainSubject) return -1;
        if (!a.isMainSubject && b.isMainSubject) return 1;
        
        // Sonra blok uzunluğuna göre
        return b.blockLength - a.blockLength;
      });
    }
  }

  // --- AŞAMA 4: NORMAL GÖREVLERİ YERLEŞTİR ---
  console.log(`--- 4. Aşama: Normal Görevler (${normalTasks.length} adet) Yerleştiriliyor... ---`);
  
  // Önce blok dersleri yerleştir
  normalTasks.sort((a, b) => b.blockLength - a.blockLength);
  
  let tasksToPlace = [...normalTasks];
  let passCount = 0;
  while(tasksToPlace.length > 0 && passCount < 5000) { 
    passCount++;
    
    const taskToAttempt = tasksToPlace.shift();
    if (!taskToAttempt) break;

    const { mapping, blockLength, classLevel, distributionDay } = taskToAttempt;
    const { teacherId, classId, subjectId } = mapping;

    const teacher = allTeachers.find(t => t.id === teacherId)!;
    const classItem = allClasses.find(c => c.id === classId)!;
    const teacherLevels = new Set(teacher.levels || [teacher.level]);
    if (!teacherLevels.has(getEntityLevel(classItem))) {
        console.warn(`ALGORITMA İHLALİ: ${teacher.name} öğretmeni, ${classItem.name} sınıfına atanamaz. Seviye uyumsuz. Bu görev atlandı.`);
        continue;
    }

    // YENİ: Öğretmenin toplam ders saati limitini kontrol et
    const currentTeacherTotalHours = Array.from(teacherLevelActualHours.get(teacherId)?.values() || []).reduce((sum, hours) => sum + hours, 0);
    
    // YENİ: Öğretmenin totalWeeklyHours değerini kontrol et (varsa)
    const teacherMaxHours = teacher.totalWeeklyHours || 45; // Öğretmenin belirtilen maksimum saati veya varsayılan 45
    
    if (currentTeacherTotalHours + blockLength > teacherMaxHours) {
      console.warn(`UYARI: ${teacher.name} öğretmeni maksimum ders saatine (${teacherMaxHours}) ulaştı. Şu anki: ${currentTeacherTotalHours}, Eklenecek: ${blockLength}`);
      taskToAttempt.isPlaced = false;
      continue;
    }

    const currentTeacherLevelHours = teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0;
    const targetTeacherLevelHours = teacherLevelTargets.get(teacherId)?.get(classLevel) || 0;
    
    if (currentTeacherLevelHours + blockLength > targetTeacherLevelHours) {
      taskToAttempt.isPlaced = false;
      continue;
    }

    let placed = false;
    
    // YENİ: Dağıtım şekli için belirli bir gün belirtilmişse, o günü önceliklendir
    let daysByPriority = [...DAYS];
    if (distributionDay !== undefined && distributionDay >= 0 && distributionDay < DAYS.length) {
      // Belirtilen günü en başa al
      const specificDay = DAYS[distributionDay];
      daysByPriority = [specificDay, ...DAYS.filter(d => d !== specificDay)];
    } else {
      // Günleri dengeli dağıtmak için, önce az ders olan günleri dene
      daysByPriority = [...DAYS].sort((a, b) => {
        const aLoad = teacherClassDailyHours.get(teacherId)?.get(a)?.get(classId) || 0;
        const bLoad = teacherClassDailyHours.get(teacherId)?.get(b)?.get(classId) || 0;
        return aLoad - bLoad;
      });
    }
    
    for (const day of daysByPriority) {
        // YENİ: Öğretmenin bu sınıfa bu gün için ders saati limitini kontrol et
        const teacherDailyHoursForClass = teacherClassDailyHours.get(teacherId)?.get(day)?.get(classId) || 0;
        const maxDailyHours = taskToAttempt.isClassTeacherTask ? 4 : 2; // Sınıf öğretmenleri için 4, diğerleri için 2
        
        if (teacherDailyHoursForClass >= maxDailyHours) {
            // Bu öğretmen bu sınıfa bu gün için maksimum ders saatine ulaşmış
            continue;
        }
        
        // YENİ: Öğretmenin bu sınıfa bu gün için bu dersten kaç saat verdiğini kontrol et
        const teacherDailyHoursForSubject = teacherClassSubjectDailyHours.get(teacherId)?.get(day)?.get(classId)?.get(subjectId) || 0;
        const maxDailyHoursPerSubject = 2; // Bir dersten günde en fazla 2 saat
        
        if (teacherDailyHoursForSubject >= maxDailyHoursPerSubject) {
            // Bu öğretmen bu sınıfa bu gün için bu dersten maksimum saate ulaşmış
            continue;
        }
        
        // YENİ: Sınıfın toplam ders saati kontrolü (45 saat limiti)
        let classWeeklyHours = 0;
        DAYS.forEach(d => {
            PERIODS.forEach(p => {
                if (classScheduleGrids[classId][d][p] && !classScheduleGrids[classId][d][p].isFixed) {
                    classWeeklyHours++;
                }
            });
        });
        
        if (classWeeklyHours >= 45) {
            console.warn(`UYARI: ${classItem.name} sınıfı maksimum haftalık ders saatine (45) ulaştı.`);
            taskToAttempt.isPlaced = false;
            break;
        }
        
        // Eğer öğretmen bu sınıfa bu gün için kalan ders saati, blok uzunluğundan azsa,
        // bloğu böl ve yerleştirilebilecek kadar yerleştir
        const remainingDailyHours = maxDailyHours - teacherDailyHoursForClass;
        const remainingDailyHoursForSubject = maxDailyHoursPerSubject - teacherDailyHoursForSubject;
        
        if (remainingDailyHours < blockLength || remainingDailyHoursForSubject < blockLength) {
            // Bloğu böl
            const placeable = Math.min(remainingDailyHours, remainingDailyHoursForSubject);
            
            if (placeable > 0 && blockLength > placeable) {
                // Yerleştirilebilecek kısmı yerleştir
                tasksToPlace.push({ 
                    ...taskToAttempt,
                    blockLength: placeable,
                    taskId: `${taskToAttempt.taskId}-split-daily-limit-placeable`
                });
                
                // Kalan kısmı başka bir görev olarak ekle
                tasksToPlace.push({ 
                    ...taskToAttempt,
                    blockLength: blockLength - placeable,
                    taskId: `${taskToAttempt.taskId}-split-daily-limit-remaining`
                });
                
                // Mevcut görevi atla
                taskToAttempt.isPlaced = false;
                break;
            }
        }
        
        for (let i = 0; i <= PERIODS.length - blockLength; i++) {
            let isAvailable = true;
            for (let j = 0; j < blockLength; j++) {
                const period = PERIODS[i+j];
                const slotKey = `${day}-${period}`;
                
                // YEMEK SAATLERİNİ KONTROL ET
                const lunchPeriod = classLevel === 'Ortaokul' ? '6' : '5';
                if (period === lunchPeriod) {
                    isAvailable = false;
                    break;
                }
                
                if (teacherAvailability.get(teacherId)?.has(slotKey) || 
                    classAvailability.get(classId)?.has(slotKey) || 
                    constraintMap.get(`subject-${subjectId}-${day}-${period}`) === 'unavailable' || 
                    constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable' || 
                    constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') {
                    isAvailable = false;
                    break;
                }
            }
            
            if (isAvailable) {
                for (let j = 0; j < blockLength; j++) {
                    const period = PERIODS[i + j];
                    const slotKey = `${day}-${period}`;
                    classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId, isFixed: false };
                    teacherAvailability.get(teacherId)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                    
                    // YENİ: Öğretmen-sınıf günlük ders saati takibini güncelle
                    if (!teacherClassDailyHours.get(teacherId)!.get(day)!.has(classId)) {
                        teacherClassDailyHours.get(teacherId)!.get(day)!.set(classId, 0);
                    }
                    teacherClassDailyHours.get(teacherId)!.get(day)!.set(
                        classId, 
                        (teacherClassDailyHours.get(teacherId)!.get(day)!.get(classId) || 0) + 1
                    );
                    
                    // YENİ: Öğretmen-sınıf-ders günlük ders saati takibini güncelle
                    if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.has(classId)) {
                        teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.set(classId, new Map<string, number>());
                    }
                    if (!teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.has(subjectId)) {
                        teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(subjectId, 0);
                    }
                    teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.set(
                        subjectId,
                        (teacherClassSubjectDailyHours.get(teacherId)!.get(day)!.get(classId)!.get(subjectId) || 0) + 1
                    );
                }
                teacherLevelActualHours.get(teacherId)?.set(classLevel, currentTeacherLevelHours + blockLength);
                placed = true;
                taskToAttempt.isPlaced = true;
                break;
            }
        }
        if (placed) break;
    }
    
    // Eğer yerleştirilemezse ve blok uzunluğu 1'den büyükse, bloğu böl
    if (!placed && blockLength > 1) {
      // Bloğu iki parçaya böl
      const firstBlockLength = Math.ceil(blockLength / 2);
      const secondBlockLength = blockLength - firstBlockLength;
      
      // İlk parça
      tasksToPlace.push({ 
        mapping, 
        blockLength: firstBlockLength, 
        taskId: `${taskToAttempt.taskId}-split-1`, 
        classLevel, 
        isPlaced: false,
        isSpecial: false,
        isClassTeacherTask: taskToAttempt.isClassTeacherTask,
        isMainSubject: taskToAttempt.isMainSubject
      });
      
      // İkinci parça
      if (secondBlockLength > 0) {
        tasksToPlace.push({ 
          mapping, 
          blockLength: secondBlockLength, 
          taskId: `${taskToAttempt.taskId}-split-2`, 
          classLevel, 
          isPlaced: false,
          isSpecial: false,
          isClassTeacherTask: taskToAttempt.isClassTeacherTask,
          isMainSubject: taskToAttempt.isMainSubject
        });
      }
      
      // Yeniden sırala
      tasksToPlace.sort((a, b) => b.blockLength - a.blockLength);
    }
  }
  
  // --- AŞAMA 5: SONUÇLARI DERLE ---
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  selectedTeacherIds.forEach(teacherId => { 
    teacherSchedules[teacherId] = {}; 
    DAYS.forEach(day => {
      teacherSchedules[teacherId][day] = {};
      
      // YEMEK SAATLERİNİ ÖĞRETMEN PROGRAMINA DA EKLE
      const teacher = allTeachers.find(t => t.id === teacherId);
      if (teacher) {
        const teacherLevel = getEntityLevel(teacher);
        const lunchPeriod = teacherLevel === 'Ortaokul' ? '6' : '5';
        
        if (PERIODS.includes(lunchPeriod)) {
          teacherSchedules[teacherId][day][lunchPeriod] = { 
            classId: 'fixed-period', 
            subjectId: 'fixed-lunch',
            isFixed: true
          };
        }
      }
    });
  });
  
  // Sınıf programlarından öğretmen programlarını oluştur
  Object.entries(classScheduleGrids).forEach(([classId, grid]) => { 
    Object.entries(grid).forEach(([day, periods]) => { 
      Object.entries(periods).forEach(([period, slot]) => { 
        if (slot && slot.teacherId) {
          // Eğer bu bir sabit slot ise (yemek, kulüp vb.)
          if (slot.isFixed) {
            if (slot.teacherId && teacherSchedules[slot.teacherId] && teacherSchedules[slot.teacherId][day]) {
              teacherSchedules[slot.teacherId][day][period] = { 
                classId: slot.classId, 
                subjectId: slot.subjectId,
                isFixed: true
              };
            }
          } 
          // Normal ders slotu
          else if (slot.teacherId && teacherSchedules[slot.teacherId] && teacherSchedules[slot.teacherId][day]) {
            teacherSchedules[slot.teacherId][day][period] = { 
              classId: slot.classId, 
              subjectId: slot.subjectId
            };
          }
        }
      });
    });
  });
  
  const finalSchedules = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({ teacherId, schedule, updatedAt: new Date() }));
  
  let totalLessonsToPlace = 0;
  teacherLevelTargets.forEach(levelMap => levelMap.forEach(hours => totalLessonsToPlace += hours));
  
  let placedLessons = 0;
  teacherLevelActualHours.forEach(levelMap => levelMap.forEach(hours => placedLessons += hours));

  // Eksik kalan dersleri tespit et
  const finalUnassignedLessons: { className: string; subjectName: string; teacherName: string; missingHours: number }[] = [];
  
  mappings.forEach(mapping => {
    const { teacherId, classId, subjectId, weeklyHours } = mapping;
    
    // Bu mapping için yerleştirilen ders saati sayısını hesapla
    let placedHoursForMapping = 0;
    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        const slot = classScheduleGrids[classId]?.[day]?.[period];
        if (slot && slot.teacherId === teacherId && slot.subjectId === subjectId && !slot.isFixed) {
          placedHoursForMapping++;
        }
      });
    });
    
    // Eksik ders saati varsa, listeye ekle
    if (placedHoursForMapping < weeklyHours) {
      const missingHours = weeklyHours - placedHoursForMapping;
      const teacher = allTeachers.find(t => t.id === teacherId);
      const classItem = allClasses.find(c => c.id === classId);
      const subject = allSubjects.find(s => s.id === subjectId);
      
      if (teacher && classItem && subject) {
        finalUnassignedLessons.push({
          className: classItem.name,
          subjectName: subject.name,
          teacherName: teacher.name,
          missingHours
        });
      }
    }
  });

  const warnings: string[] = [];
  if (placedLessons < totalLessonsToPlace) { 
    warnings.push("Tüm ders saatleri yerleştirilemedi. Kısıtlamalar ve yoğun programlar nedeniyle bazı dersler boşta kalmış olabilir."); 
  }
  
  // YENİ: Sınıfların 45 saatlik ders limiti kontrolü
  selectedClassIds.forEach(classId => {
    let classWeeklyHours = 0;
    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        if (classScheduleGrids[classId][day][period] && !classScheduleGrids[classId][day][period].isFixed) {
          classWeeklyHours++;
        }
      });
    });
    
    const classItem = allClasses.find(c => c.id === classId);
    if (classWeeklyHours < 45) {
      warnings.push(`${classItem?.name || classId} sınıfı için haftalık ders saati 45'in altında: ${classWeeklyHours} saat`);
    }
  });
  
  // YENİ: Sınıf öğretmeni görevlerinin yerleştirilme durumunu kontrol et
  const unplacedClassTeacherTasks = classTeacherTasks.filter(task => !task.isPlaced);
  if (unplacedClassTeacherTasks.length > 0) {
    const unplacedClassTeacherTasksCount = unplacedClassTeacherTasks.length;
    warnings.push(`${unplacedClassTeacherTasksCount} sınıf öğretmeni görevi yerleştirilemedi. Kısıtlamalar ve çakışmalar nedeniyle bazı dersler boşta kalmış olabilir.`);
  }
  
  // YENİ: Sınıf öğretmeni görevlerinin yerleştirilme oranını hesapla
  const totalClassTeacherTasks = classTeacherTasks.length;
  const placedClassTeacherTasks = classTeacherTasks.filter(task => task.isPlaced).length;
  const classTeacherTasksPlacementRate = totalClassTeacherTasks > 0 ? Math.round((placedClassTeacherTasks / totalClassTeacherTasks) * 100) : 100;
  
  // YENİ: Öğretmenlerin haftalık ders saati limitlerini kontrol et
  const teacherWeeklyHoursViolations: string[] = [];
  selectedTeacherIds.forEach(teacherId => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;
    
    // Öğretmenin toplam ders saatini hesapla
    const totalHours = Array.from(teacherLevelActualHours.get(teacherId)?.values() || []).reduce((sum, hours) => sum + hours, 0);
    
    // Öğretmenin maksimum ders saati (totalWeeklyHours varsa onu kullan, yoksa 45)
    const maxWeeklyHours = teacher.totalWeeklyHours || 45;
    
    // Eğer öğretmen maksimum ders saatini aşmışsa, uyarı ekle
    if (totalHours > maxWeeklyHours) {
      teacherWeeklyHoursViolations.push(
        `${teacher.name} öğretmeni maksimum haftalık ders saatini (${maxWeeklyHours}) aşıyor: ${totalHours} saat`
      );
    }
  });
  
  if (teacherWeeklyHoursViolations.length > 0) {
    warnings.push(...teacherWeeklyHoursViolations);
  }
  
  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye. Sonuç: ${placedLessons} / ${totalLessonsToPlace}`);
  console.log(`📊 Sınıf öğretmeni görevleri: ${placedClassTeacherTasks} / ${totalClassTeacherTasks} (${classTeacherTasksPlacementRate}%)`);
  
  return {
    success: true,
    schedules: finalSchedules,
    statistics: { 
      totalLessonsToPlace, 
      placedLessons, 
      unassignedLessons: finalUnassignedLessons 
    },
    warnings,
    errors: [],
  };
}