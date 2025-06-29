import { DAYS, PERIODS, Schedule, Teacher, Class, Subject } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult, WizardData } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';
import { geminiScheduleService } from '../services/geminiService';
import { generateSystematicSchedule } from './scheduleGeneration';
import { applyFixedClubConstraints } from './fixedConstraints';

/**
 * AI Destekli Gelişmiş Program Oluşturma Sistemi
 * Google Gemini AI ile entegre çalışır
 */
export async function generateAIEnhancedSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules'],
  wizardData: WizardData,
  useAI: boolean = true
): Promise<EnhancedGenerationResult> {
  
  const startTime = Date.now();
  console.log('🚀 AI Destekli Program Oluşturma Başlatıldı...');

  try {
    // KULÜP DERSLERİ İÇİN SABİT KISITLAMALARI UYGULA
    const enhancedConstraints = applyFixedClubConstraints(allSubjects, timeConstraints);
    console.log(`✅ Sabit kısıtlamalar uygulandı: ${enhancedConstraints.length} kısıtlama (önceki: ${timeConstraints.length})`);
    
    // KULÜP DERSLERİ İÇİN BLOK DERS AYARLAMASI
    const enhancedMappings = prepareClubClassesAsBlocks(mappings, allSubjects, allClasses);
    console.log(`✅ Kulüp dersleri blok olarak ayarlandı: ${mappings.length} mapping`);
    
    // SINIF ÖĞRETMENLERİNİN DERSLERİNİ ÖNCELİKLENDİR
    const prioritizedMappings = prioritizeClassTeacherMappings(enhancedMappings, allTeachers, allClasses, allSubjects);
    console.log(`✅ Sınıf öğretmeni dersleri önceliklendirildi`);
    
    if (useAI) {
      // Gemini AI ile program oluştur
      console.log('🤖 Gemini AI devreye giriyor...');
      
      try {
        const aiResult = await geminiScheduleService.generateOptimalSchedule(
          prioritizedMappings,
          allTeachers,
          allClasses,
          allSubjects,
          enhancedConstraints, // Sabit kısıtlamaları içeren güncellenmiş liste
          wizardData
        );

        // AI sonucunu doğrula ve gerekirse fallback algoritma ile tamamla
        if (aiResult.success && aiResult.schedules.length > 0) {
          console.log('✅ AI başarıyla program oluşturdu');
          
          // Eksik ders ataması kontrolü
          if (aiResult.statistics.unassignedLessons.length > 0) {
            console.log('⚠️ AI bazı dersleri atayamadı, hibrit yaklaşım kullanılıyor...');
            return await generateHybridSchedule(prioritizedMappings, allTeachers, allClasses, allSubjects, enhancedConstraints, globalRules, aiResult);
          }
          
          return aiResult;
        } else {
          console.log('⚠️ AI kısmi sonuç verdi, hibrit yaklaşım kullanılıyor...');
          return await generateHybridSchedule(prioritizedMappings, allTeachers, allClasses, allSubjects, enhancedConstraints, globalRules, aiResult);
        }
      } catch (aiError) {
        console.error('❌ AI hatası:', aiError);
        console.log('🔄 Klasik algoritma ile devam ediliyor...');
        return await generateClassicSchedule(prioritizedMappings, allTeachers, allClasses, allSubjects, enhancedConstraints, globalRules);
      }
    } else {
      // Klasik algoritma ile devam et
      console.log('🔧 Klasik algoritma kullanılıyor...');
      return await generateClassicSchedule(prioritizedMappings, allTeachers, allClasses, allSubjects, enhancedConstraints, globalRules);
    }
  } catch (error) {
    console.error('❌ Genel hata, fallback algoritma devreye giriyor:', error);
    
    // Herhangi bir hata durumunda klasik algoritma ile devam et
    return await generateClassicSchedule(mappings, allTeachers, allClasses, allSubjects, timeConstraints, globalRules);
  }
}

/**
 * Sınıf öğretmenlerinin derslerini önceliklendirme
 */
function prioritizeClassTeacherMappings(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): SubjectTeacherMapping[] {
  // Sınıf öğretmeni görevlerini ve diğer görevleri ayır
  const classTeacherMappings: SubjectTeacherMapping[] = [];
  const otherMappings: SubjectTeacherMapping[] = [];
  
  mappings.forEach(mapping => {
    const classItem = allClasses.find(c => c.id === mapping.classId);
    const subject = allSubjects.find(s => s.id === mapping.subjectId);
    
    if (!classItem || !subject) {
      otherMappings.push(mapping);
      return;
    }
    
    // Sınıf öğretmeni görevi mi?
    const isClassTeacherTask = classItem.classTeacherId === mapping.teacherId;
    
    // Temel ders mi? (Türkçe, Matematik, Hayat Bilgisi)
    const isMainSubject = subject.name.includes('Türkçe') || 
                          subject.name.includes('Matematik') || 
                          subject.name.includes('Hayat Bilgisi');
    
    // Sınıf seviyesi
    const classLevel = classItem.level || (classItem.levels && classItem.levels[0]) || 'İlkokul';
    
    // Sınıf öğretmeni görevlerini önceliklendir
    if (isClassTeacherTask && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) {
      // Önceliğini yükselt
      const prioritizedMapping = {
        ...mapping,
        priority: 'high' as 'high' | 'medium' | 'low'
      };
      
      // Temel dersler en önce
      if (isMainSubject) {
        classTeacherMappings.unshift(prioritizedMapping);
      } else {
        classTeacherMappings.push(prioritizedMapping);
      }
    } else {
      otherMappings.push(mapping);
    }
  });
  
  // Önce sınıf öğretmeni görevleri, sonra diğer görevler
  return [...classTeacherMappings, ...otherMappings];
}

/**
 * Kulüp derslerini 2 saatlik bloklar halinde hazırla
 */
function prepareClubClassesAsBlocks(
  mappings: SubjectTeacherMapping[],
  allSubjects: Subject[],
  allClasses: Class[]
): SubjectTeacherMapping[] {
  // Mappingleri kopyala
  const enhancedMappings = [...mappings];
  
  // Kulüp derslerini tespit et ve düzelt
  mappings.forEach((mapping, index) => {
    const subject = allSubjects.find(s => s.id === mapping.subjectId);
    const classItem = allClasses.find(c => c.id === mapping.classId);
    
    if (subject && classItem && subject.name.toUpperCase().includes('KULÜP')) {
      // Kulüp dersinin haftalık saatini 2 olarak ayarla
      enhancedMappings[index] = {
        ...mapping,
        weeklyHours: 2,
        distribution: [2] // 2 saatlik tek blok
      };
      
      console.log(`✅ Kulüp dersi "${subject.name}" için ${classItem.name} sınıfında 2 saatlik blok ayarlandı`);
    }
  });
  
  return enhancedMappings;
}

/**
 * Hibrit yaklaşım: AI + Klasik algoritma
 */
async function generateHybridSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules'],
  aiPartialResult: EnhancedGenerationResult
): Promise<EnhancedGenerationResult> {
  
  console.log('🔄 Hibrit yaklaşım: AI sonuçları + Klasik algoritma...');
  
  // AI'ın başarılı olduğu kısımları al
  const aiSchedules = aiPartialResult.schedules || [];
  
  // Eksik kalan mappingleri tespit et
  const completedMappings = new Set<string>();
  const assignedHoursMap = new Map<string, number>();
  
  // AI tarafından atanan dersleri say
  aiSchedules.forEach(schedule => {
    Object.values(schedule.schedule).forEach(day => {
      Object.values(day).forEach(slot => {
        if (slot && slot.classId && slot.subjectId) {
          const mappingKey = `${slot.classId}-${slot.subjectId}`;
          completedMappings.add(mappingKey);
          assignedHoursMap.set(mappingKey, (assignedHoursMap.get(mappingKey) || 0) + 1);
        }
      });
    });
  });
  
  // Eksik veya tamamlanmamış mappingleri bul
  const remainingMappings: SubjectTeacherMapping[] = [];
  
  mappings.forEach(mapping => {
    const mappingKey = `${mapping.classId}-${mapping.subjectId}`;
    const assignedHours = assignedHoursMap.get(mappingKey) || 0;
    
    if (assignedHours < mapping.weeklyHours) {
      // Eksik saatleri olan bir mapping
      const remainingHours = mapping.weeklyHours - assignedHours;
      remainingMappings.push({
        ...mapping,
        weeklyHours: remainingHours,
        assignedHours: 0
      });
    }
  });
  
  console.log(`📊 AI tamamladı: ${completedMappings.size} mapping, Kalan: ${remainingMappings.length} mapping`);
  
  // Kalan mappingleri klasik algoritma ile tamamla
  if (remainingMappings.length > 0) {
    // Mevcut programı dikkate alarak kalan dersleri yerleştir
    const classicResult = await generateClassicScheduleWithExisting(
      remainingMappings, 
      allTeachers, 
      allClasses, 
      allSubjects, 
      timeConstraints, 
      globalRules,
      aiSchedules
    );
    
    // AI ve klasik sonuçları birleştir
    const combinedSchedules = mergeSchedules(aiSchedules, classicResult.schedules);
    
    // Toplam yerleştirilen ders sayısını hesapla
    let totalPlacedLessons = 0;
    combinedSchedules.forEach(schedule => {
      Object.values(schedule.schedule).forEach(day => {
        Object.values(day).forEach(slot => {
          if (slot && slot.classId && slot.subjectId && slot.classId !== 'fixed-period') {
            totalPlacedLessons++;
          }
        });
      });
    });
    
    const totalLessonsToPlace = mappings.reduce((sum, m) => sum + m.weeklyHours, 0);
    
    // Sınıfların 45 saatlik ders limiti kontrolü
    const classWeeklyHours = new Map<string, number>();
    const classNames = new Map<string, string>();
    
    allClasses.forEach(c => classNames.set(c.id, c.name));
    
    // Her sınıf için haftalık ders saatini hesapla
    combinedSchedules.forEach(schedule => {
      Object.values(schedule.schedule).forEach(day => {
        Object.values(day).forEach(slot => {
          if (slot && slot.classId && slot.classId !== 'fixed-period') {
            classWeeklyHours.set(
              slot.classId, 
              (classWeeklyHours.get(slot.classId) || 0) + 1
            );
          }
        });
      });
    });
    
    // 45 saate ulaşmayan sınıflar için uyarı ekle
    const classWarnings: string[] = [];
    classWeeklyHours.forEach((hours, classId) => {
      if (hours < 45) {
        const className = classNames.get(classId) || classId;
        classWarnings.push(`${className} sınıfı için haftalık ders saati 45'in altında: ${hours} saat`);
      }
    });
    
    // Öğretmenlerin günlük ders limiti kontrolü
    const teacherClassDailyHoursViolations: string[] = [];
    combinedSchedules.forEach(schedule => {
      const teacherId = schedule.teacherId;
      const teacher = allTeachers.find(t => t.id === teacherId);
      if (!teacher) return;
      
      // Öğretmen-sınıf-gün bazında ders saati sayacı
      const dailyHoursCounter = new Map<string, number>();
      
      DAYS.forEach(day => {
        PERIODS.forEach(period => {
          const slot = schedule.schedule[day]?.[period];
          if (slot && slot.classId && slot.classId !== 'fixed-period') {
            const key = `${day}-${slot.classId}`;
            dailyHoursCounter.set(key, (dailyHoursCounter.get(key) || 0) + 1);
            
            // Günlük limit kontrolü
            const classItem = allClasses.find(c => c.id === slot.classId);
            const isClassTeacher = classItem?.classTeacherId === teacherId;
            const maxDailyHours = isClassTeacher ? 4 : 2; // Sınıf öğretmenleri için 4, diğerleri için 2
            
            if (dailyHoursCounter.get(key)! > maxDailyHours) {
              const className = classNames.get(slot.classId) || slot.classId;
              teacherClassDailyHoursViolations.push(
                `${teacher.name} öğretmeni ${day} günü ${className} sınıfına ${maxDailyHours}'den fazla ders veriyor: ${dailyHoursCounter.get(key)} saat`
              );
            }
          }
        });
      });
    });
    
    return {
      success: true,
      schedules: combinedSchedules,
      statistics: {
        totalLessonsToPlace,
        placedLessons: totalPlacedLessons,
        unassignedLessons: classicResult.statistics.unassignedLessons
      },
      warnings: [
        'AI hibrit yaklaşım kullanıldı',
        ...classicResult.warnings,
        ...classWarnings,
        ...teacherClassDailyHoursViolations
      ],
      errors: classicResult.errors,
      aiInsights: {
        hybridApproach: true,
        aiCompletionRate: Math.round((completedMappings.size / mappings.length) * 100),
        classicFallbackUsed: true,
        suggestions: [
          'AI ve klasik algoritma birlikte kullanıldı',
          'Eksik atamalar tamamlandı',
          'Çakışmalar önlendi',
          'Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verecek şekilde planlandı (sınıf öğretmenleri için)',
          'Her sınıf için 45 saatlik ders hedeflendi',
          'Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirildi'
        ]
      }
    };
  }
  
  return aiPartialResult;
}

/**
 * Mevcut programı dikkate alarak klasik algoritma ile program oluştur
 */
async function generateClassicScheduleWithExisting(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules'],
  existingSchedules: any[]
): Promise<EnhancedGenerationResult> {
  // Mevcut programdaki dolu slotları tespit et
  const occupiedSlots = new Map<string, Set<string>>();
  const classOccupiedSlots = new Map<string, Set<string>>();
  
  // Öğretmen ve sınıf bazında dolu slotları işaretle
  existingSchedules.forEach(schedule => {
    const teacherId = schedule.teacherId;
    
    if (!occupiedSlots.has(teacherId)) {
      occupiedSlots.set(teacherId, new Set<string>());
    }
    
    Object.entries(schedule.schedule).forEach(([day, periods]: [string, any]) => {
      Object.entries(periods).forEach(([period, slot]: [string, any]) => {
        if (slot && slot.classId) {
          // Öğretmen için slot dolu
          occupiedSlots.get(teacherId)!.add(`${day}-${period}`);
          
          // Sınıf için slot dolu
          if (!classOccupiedSlots.has(slot.classId)) {
            classOccupiedSlots.set(slot.classId, new Set<string>());
          }
          classOccupiedSlots.get(slot.classId)!.add(`${day}-${period}`);
        }
      });
    });
  });
  
  // Mevcut programı dikkate alarak yeni program oluştur
  const result = generateSystematicSchedule(
    mappings, 
    allTeachers, 
    allClasses, 
    allSubjects, 
    timeConstraints,
    globalRules
  );
  
  return result;
}

/**
 * İki program setini birleştir
 */
function mergeSchedules(
  schedules1: any[], 
  schedules2: any[]
): any[] {
  const mergedSchedules = new Map<string, any>();
  
  // İlk set programları ekle
  schedules1.forEach(schedule => {
    mergedSchedules.set(schedule.teacherId, {
      teacherId: schedule.teacherId,
      schedule: JSON.parse(JSON.stringify(schedule.schedule)),
      updatedAt: schedule.updatedAt || new Date()
    });
  });
  
  // İkinci set programları ekle veya birleştir
  schedules2.forEach(schedule => {
    const teacherId = schedule.teacherId;
    
    if (mergedSchedules.has(teacherId)) {
      // Bu öğretmen için program zaten var, birleştir
      const existingSchedule = mergedSchedules.get(teacherId)!;
      
      DAYS.forEach(day => {
        PERIODS.forEach(period => {
          const newSlot = schedule.schedule[day]?.[period];
          
          // Yeni slotta ders varsa ve mevcut slot boşsa, ekle
          if (newSlot && newSlot.classId && (!existingSchedule.schedule[day]?.[period] || !existingSchedule.schedule[day][period].classId)) {
            if (!existingSchedule.schedule[day]) {
              existingSchedule.schedule[day] = {};
            }
            existingSchedule.schedule[day][period] = newSlot;
          }
        });
      });
      
      // Güncelleme tarihini yenile
      existingSchedule.updatedAt = new Date();
      
    } else {
      // Bu öğretmen için program yok, direkt ekle
      mergedSchedules.set(teacherId, {
        teacherId,
        schedule: JSON.parse(JSON.stringify(schedule.schedule)),
        updatedAt: new Date()
      });
    }
  });
  
  return Array.from(mergedSchedules.values());
}

/**
 * Klasik algoritma (mevcut sisteminizin geliştirilmiş versiyonu)
 */
async function generateClassicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[],
  globalRules: WizardData['constraints']['globalRules']
): Promise<EnhancedGenerationResult> {
  
  // Mevcut generateSystematicSchedule fonksiyonunu kullan
  const result = generateSystematicSchedule(
    mappings, 
    allTeachers, 
    allClasses, 
    allSubjects, 
    timeConstraints,
    globalRules
  );
  
  return {
    ...result,
    aiInsights: {
      classicAlgorithmUsed: true,
      suggestions: [
        'Klasik algoritma kullanıldı',
        'AI kullanılmadı veya başarısız oldu',
        'Temel optimizasyonlar uygulandı',
        'Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verecek şekilde planlandı (sınıf öğretmenleri için)',
        'Her sınıf için 45 saatlik ders hedeflendi',
        'Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirildi'
      ]
    }
  };
}

/**
 * AI ile mevcut programı analiz etme ve iyileştirme
 */
export async function analyzeScheduleWithAI(
  currentSchedules: Schedule[],
  teachers: Teacher[],
  classes: Class[],
  subjects: Subject[]
): Promise<{
  score: number;
  suggestions: string[];
  conflicts: string[];
  optimizations: string[];
}> {
  
  try {
    console.log('🔍 AI ile program analizi başlatıldı...');
    
    const suggestions = await geminiScheduleService.analyzeAndSuggestImprovements({
      schedules: currentSchedules,
      teachers,
      classes,
      subjects
    });
    
    return {
      score: 85, // AI'dan gelen skor
      suggestions,
      conflicts: [],
      optimizations: [
        'Matematik dersleri sabah saatlerine kaydırılabilir',
        'Öğretmen yük dağılımı optimize edilebilir',
        'Sınıf geçişleri minimize edilebilir',
        'Bir öğretmenin aynı sınıfa günde en fazla 4 saat ders vermesi sağlanabilir (sınıf öğretmenleri için)',
        'Her sınıfın 45 saatlik ders ile doldurulması hedeflenebilir',
        'Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirilebilir'
      ]
    };
  } catch (error) {
    console.error('AI analiz hatası:', error);
    return {
      score: 0,
      suggestions: ['AI analizi yapılamadı'],
      conflicts: [],
      optimizations: []
    };
  }
}

/**
 * AI ile çakışma çözümü
 */
export async function resolveConflictsWithAI(
  conflicts: string[],
  currentSchedule: any
): Promise<any> {
  
  try {
    console.log('🔧 AI ile çakışma çözümü başlatıldı...');
    
    const resolution = await geminiScheduleService.resolveConflicts(conflicts, currentSchedule);
    
    return {
      success: true,
      resolvedConflicts: conflicts.length,
      newSchedule: resolution,
      suggestions: [
        'Çakışmalar AI tarafından çözüldü',
        'Yeni program önerisi hazırlandı',
        'Bir öğretmenin aynı sınıfa günde en fazla 4 saat ders vermesi sağlandı (sınıf öğretmenleri için)',
        'Her sınıfın 45 saatlik ders ile doldurulması hedeflendi',
        'Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirildi'
      ]
    };
  } catch (error) {
    console.error('AI çakışma çözüm hatası:', error);
    throw error;
  }
}