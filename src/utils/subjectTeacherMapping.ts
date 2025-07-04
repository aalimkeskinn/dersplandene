// --- START OF FILE src/utils/subjectTeacherMapping.ts ---

import { Teacher, Class, Subject, parseDistributionPattern } from '../types';
import { WizardData, SubjectTeacherMapping } from '../types/wizard';

function getEntityLevel(entity: Teacher | Class): 'Anaokulu' | 'İlkokul' | 'Ortaokul' {
    return (entity as any).level || (entity as any).levels?.[0] || 'İlkokul';
}

export function createSubjectTeacherMappings(
  wizardData: WizardData,
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): { mappings: SubjectTeacherMapping[], errors: string[] } {
  
  const mappings: SubjectTeacherMapping[] = [];
  const errors: string[] = [];

  const selectedClassIds = new Set(wizardData.classes.selectedClasses);
  const selectedSubjectIds = new Set(wizardData.subjects.selectedSubjects);
  const selectedTeacherIds = new Set(wizardData.teachers.selectedTeachers);

  // YENİ: Öğretmenlerin toplam ders saatlerini takip et
  const teacherAssignedHours = new Map<string, number>();
  
  // YENİ: Önce sınıf öğretmenlerinin atamalarını işle
  const classTeacherMappings: SubjectTeacherMapping[] = [];
  const regularMappings: SubjectTeacherMapping[] = [];

  for (const classId of selectedClassIds) {
    const classItem = allClasses.find(c => c.id === classId);
    if (!classItem || !classItem.assignments || classItem.assignments.length === 0) continue;

    // Sınıf seviyesini al
    const classLevel = getEntityLevel(classItem);
    
    // Sınıf öğretmeni ID'sini al
    const classTeacherId = classItem.classTeacherId;
    
    for (const assignment of classItem.assignments) {
      const teacherId = assignment.teacherId;
      const teacher = allTeachers.find(t => t.id === teacherId);

      if (!selectedTeacherIds.has(teacherId) || !teacher) continue;
      
      // *** YENİ: Seviye uyumluluğunu burada kontrol et ***
      const teacherLevels = new Set(teacher.levels || [teacher.level]);
      if (!teacherLevels.has(classLevel)) {
          errors.push(`UYARI: ${teacher.name} (${[...teacherLevels].join(', ')}) öğretmeni, ${classItem.name} (${classLevel}) sınıfının seviyesiyle uyumsuz. Bu atama yoksayıldı.`);
          continue; // Bu öğretmeni bu sınıf için atla
      }

      // Bu öğretmen sınıf öğretmeni mi?
      const isClassTeacherTask = classItem.classTeacherId === teacherId;

      for (const subjectId of assignment.subjectIds) {
        if (!selectedSubjectIds.has(subjectId)) continue;
        
        const subject = allSubjects.find(s => s.id === subjectId);
        if (!subject) continue;
        
        const mappingExists = mappings.some(m => m.classId === classId && m.subjectId === subjectId);
        if (!mappingExists) {
          const weeklyHours = subject.weeklyHours;
          const distribution = subject.distributionPattern ? parseDistributionPattern(subject.distributionPattern) : undefined;

          // YENİ: Öğretmenin toplam ders saatini takip et
          if (!teacherAssignedHours.has(teacherId)) {
            teacherAssignedHours.set(teacherId, 0);
          }
          teacherAssignedHours.set(teacherId, teacherAssignedHours.get(teacherId)! + weeklyHours);
          
          // YENİ: Öğretmenin haftalık ders saati limitini kontrol et
          const teacherTotalHours = teacherAssignedHours.get(teacherId)!;
          const teacherMaxHours = teacher.totalWeeklyHours || 45;
          
          if (teacherTotalHours > teacherMaxHours) {
            errors.push(`UYARI: ${teacher.name} öğretmeninin toplam ders saati (${teacherTotalHours}) maksimum limiti (${teacherMaxHours}) aşıyor!`);
          }

          // Temel ders mi kontrol et (Türkçe, Matematik, Hayat Bilgisi)
          const isMainSubject = subject.name.includes('Türkçe') || 
                                subject.name.includes('Matematik') || 
                                subject.name.includes('Hayat Bilgisi');

          const task: SubjectTeacherMapping = {
            id: `${classId}-${subjectId}`, 
            classId, 
            subjectId, 
            teacherId, 
            weeklyHours,
            assignedHours: 0, 
            distribution, 
            priority: isClassTeacherTask ? 'high' : isMainSubject ? 'high' : 'medium', // Sınıf öğretmenlerine ve temel derslere yüksek öncelik
          };

          if (distribution && distribution.reduce((a, b) => a + b, 0) !== weeklyHours) {
            errors.push(`UYARI: ${classItem.name} > ${subject.name} dersinin dağıtım şekli (${subject.distributionPattern}) haftalık saatle (${weeklyHours}) uyuşmuyor. Ders 1'er saatlik bloklar halinde yerleştirilecek.`);
            delete task.distribution;
          }
          
          // Sınıf öğretmeni görevlerini ayrı bir diziye ekle
          if (isClassTeacherTask && (classLevel === 'İlkokul' || classLevel === 'Anaokulu')) {
            classTeacherMappings.push(task);
          } else {
            regularMappings.push(task);
          }
        }
      }
    }
  }

  // Önce sınıf öğretmeni görevlerini, sonra diğer görevleri ekle
  mappings.push(...classTeacherMappings, ...regularMappings);
  
  if (mappings.length === 0 && selectedSubjectIds.size > 0) {
    errors.push("Hiçbir geçerli ders ataması bulunamadı. Lütfen 'Sınıflar' ekranından öğretmenlere ders atadığınızdan ve sihirbazda ilgili tüm (sınıf, öğretmen, ders) öğeleri seçtiğinizden emin olun.");
  }

  return { mappings, errors };
}

// --- END OF FILE src/utils/subjectTeacherMapping.ts ---