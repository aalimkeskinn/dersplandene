// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

const LEVEL_ORDER: Record<'Anaokulu' | 'İlkokul' | 'Ortaokul', number> = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

/**
 * "Öncelikli Kısıtlı Görev" Algoritması (v41 - Blok Kulüp Dersleri)
 * 1. "KULÜP" derslerini sabit zaman dilimlerinde 2 saatlik bloklar halinde yerleştirir
 * 2. "ADE" gibi özel dersleri tespit eder ve kısıtlamalarına göre yerleştirir
 * 3. Ardından kalan normal dersleri, boş kalan slotlara en verimli şekilde dağıtır
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
  console.log('🚀 Program oluşturma başlatıldı (v41 - Blok Kulüp Dersleri)...');

  // --- AŞAMA 1: VERİ MATRİSLERİNİ VE GÖREVLERİ HAZIRLA ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  const constraintMap = new Map<string, string>();

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
      const lunchPeriod = getEntityLevel(classItem) === 'Ortaokul' ? '6' : '5';
      if (PERIODS.includes(lunchPeriod)) {
        DAYS.forEach(day => { classScheduleGrids[classId][day][lunchPeriod] = { isFixed: true, classId: 'fixed-period', subjectId: 'Yemek' }; classAvailability.get(classId)!.add(`${day}-${lunchPeriod}`); });
      }
    }
  });

  const selectedTeacherIds = new Set(mappings.map(m => m.teacherId));
  selectedTeacherIds.forEach(teacherId => { teacherAvailability.set(teacherId, new Set<string>()); });
  
  type PlacementTask = { 
    mapping: SubjectTeacherMapping; 
    blockLength: number; 
    taskId: string; 
    classLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul'; 
    isPlaced: boolean; 
    isSpecial: boolean;
    isKulupDersi?: boolean;
    fixedSlots?: {day: string, period: string}[];
  };
  
  let specialTasks: PlacementTask[] = [];
  let normalTasks: PlacementTask[] = [];

  mappings.forEach(mapping => {
    const classItem = allClasses.find(c => c.id === mapping.classId)!;
    const subject = allSubjects.find(s => s.id === mapping.subjectId)!;
    const classLevel = getEntityLevel(classItem);
    const distribution = mapping.distribution || [];
    
    // KULÜP DERSLERİ İÇİN ÖZEL KONTROL
    const isKulupDersi = subject.name.toUpperCase().includes('KULÜP');
    const isADEDersi = subject.name.toUpperCase().includes('ADE');
    const isSpecial = isKulupDersi || isADEDersi;
    const hasSpecificConstraints = timeConstraints.some(c => c.entityType === 'subject' && c.entityId === subject.id);

    // Kulüp dersleri için özel işlem
    if (isKulupDersi) {
      // İlkokul kulüp dersleri Perşembe 9-10. ders saatlerinde
      if (classLevel === 'İlkokul') {
        specialTasks.push({ 
          mapping, 
          blockLength: 2, // 2 saatlik blok
          taskId: `${mapping.id}-kulup-ilkokul`, 
          classLevel, 
          isPlaced: false,
          isSpecial: true,
          isKulupDersi: true,
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
          isSpecial: true
        });
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
            isSpecial: false
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
          isSpecial: false
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
          isFixed: true // Kulüp dersleri sabit olarak işaretlenir
        };
        
        // Müsaitlik durumlarını güncelle
        teacherAvailability.get(teacherId)!.add(slotKey);
        classAvailability.get(classId)!.add(slotKey);
        
        // Ders saati sayacını güncelle
        const currentHours = teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0;
        teacherLevelActualHours.get(teacherId)?.set(classLevel, currentHours + 1);
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
          preferredSlots.push({ day, period });
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
        placed = true;
        task.isPlaced = true;
        break;
      }
    }
  }

  // --- AŞAMA 4: NORMAL GÖREVLERİ YERLEŞTİR ---
  console.log(`--- 3. Aşama: Normal Görevler (${normalTasks.length} adet) Yerleştiriliyor... ---`);
  
  // Önce blok dersleri yerleştir
  normalTasks.sort((a, b) => b.blockLength - a.blockLength);
  
  let tasksToPlace = [...normalTasks];
  let passCount = 0;
  while(tasksToPlace.length > 0 && passCount < 5000) { 
    passCount++;
    
    const taskToAttempt = tasksToPlace.shift();
    if (!taskToAttempt) break;

    const { mapping, blockLength, classLevel } = taskToAttempt;
    const { teacherId, classId, subjectId } = mapping;

    const teacher = allTeachers.find(t => t.id === teacherId)!;
    const classItem = allClasses.find(c => c.id === classId)!;
    const teacherLevels = new Set(teacher.levels || [teacher.level]);
    if (!teacherLevels.has(getEntityLevel(classItem))) {
        console.warn(`ALGORITMA İHLALİ: ${teacher.name} öğretmeni, ${classItem.name} sınıfına atanamaz. Seviye uyumsuz. Bu görev atlandı.`);
        continue;
    }

    const currentTeacherLevelHours = teacherLevelActualHours.get(teacherId)?.get(classLevel) || 0;
    const targetTeacherLevelHours = teacherLevelTargets.get(teacherId)?.get(classLevel) || 0;
    
    if (currentTeacherLevelHours + blockLength > targetTeacherLevelHours) {
      taskToAttempt.isPlaced = false;
      continue;
    }

    let placed = false;
    for (const day of [...DAYS].sort(() => Math.random() - 0.5)) {
        for (let i = 0; i <= PERIODS.length - blockLength; i++) {
            let isAvailable = true;
            for (let j = 0; j < blockLength; j++) {
                const period = PERIODS[i+j];
                const slotKey = `${day}-${period}`;
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
        isSpecial: false
      });
      
      // İkinci parça
      if (secondBlockLength > 0) {
        tasksToPlace.push({ 
          mapping, 
          blockLength: secondBlockLength, 
          taskId: `${taskToAttempt.taskId}-split-2`, 
          classLevel, 
          isPlaced: false,
          isSpecial: false
        });
      }
      
      // Yeniden sırala
      tasksToPlace.sort((a, b) => b.blockLength - a.blockLength);
    }
  }
  
  // --- AŞAMA 5: SONUÇLARI DERLE ---
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  selectedTeacherIds.forEach(teacherId => { teacherSchedules[teacherId] = {}; DAYS.forEach(day => teacherSchedules[teacherId][day] = {}); });
  Object.entries(classScheduleGrids).forEach(([classId, grid]) => { Object.entries(grid).forEach(([day, periods]) => { Object.entries(periods).forEach(([period, slot]) => { if (slot && slot.teacherId && !slot.isFixed) { teacherSchedules[slot.teacherId][day][period] = { classId, subjectId: slot.subjectId }; } }); }); });
  const finalSchedules = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({ teacherId, schedule, updatedAt: new Date() }));
  
  let totalLessonsToPlace = 0;
  teacherLevelTargets.forEach(levelMap => levelMap.forEach(hours => totalLessonsToPlace += hours));
  
  let placedLessons = 0;
  teacherLevelActualHours.forEach(levelMap => levelMap.forEach(hours => placedLessons += hours));

  const finalUnassignedLessons: { [key: string]: any } = {};
  if (placedLessons < totalLessonsToPlace) {
    teacherLevelTargets.forEach((levelMap, teacherId) => {
        levelMap.forEach((targetHours, level) => {
            const actualHours = teacherLevelActualHours.get(teacherId)?.get(level) || 0;
            if (actualHours < targetHours) {
                const missing = targetHours - actualHours;
                const teacherName = allTeachers.find(t => t.id === teacherId)?.name || '?';
                const key = `${teacherName}-${level}`;
                if (!finalUnassignedLessons[key]) { finalUnassignedLessons[key] = { teacherName, level, missingHours: 0 }; }
                finalUnassignedLessons[key].missingHours += missing;
            }
        });
    });
  }

  const warnings: string[] = [];
  if (placedLessons < totalLessonsToPlace) { warnings.push("Tüm ders saatleri yerleştirilemedi. Kısıtlamalar ve yoğun programlar nedeniyle bazı dersler boşta kalmış olabilir."); }
  
  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye. Sonuç: ${placedLessons} / ${totalLessonsToPlace}`);
  
  return {
    success: true,
    schedules: finalSchedules,
    statistics: { totalLessonsToPlace, placedLessons, unassignedLessons: Object.values(finalUnassignedLessons) },
    warnings,
    errors: [],
  };
}
// --- END OF FILE src/utils/scheduleGeneration.ts ---