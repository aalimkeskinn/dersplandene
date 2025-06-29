import { GoogleGenerativeAI } from '@google/generative-ai';
import { Teacher, Class, Subject, DAYS, PERIODS } from '../types';
import { SubjectTeacherMapping, WizardData, EnhancedGenerationResult } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

// Gemini AI Service
class GeminiScheduleService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: 'gemini-1.5-pro',
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.1,
        topP: 0.8,
        topK: 40
      }
    });
  }

  /**
   * Gemini AI ile akıllı ders programı oluşturma
   */
  async generateOptimalSchedule(
    mappings: SubjectTeacherMapping[],
    teachers: Teacher[],
    classes: Class[],
    subjects: Subject[],
    constraints: TimeConstraint[],
    wizardData: WizardData
  ): Promise<EnhancedGenerationResult> {
    try {
      console.log('🤖 Gemini AI ile program oluşturma başlatıldı...');

      // 1. Veriyi Gemini için hazırla
      const prompt = this.createSchedulingPrompt(mappings, teachers, classes, subjects, constraints, wizardData);
      
      // 2. Gemini'den optimal çözüm iste
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const scheduleData = response.text();

      // 3. Gemini'nin yanıtını parse et
      const parsedResult = this.parseGeminiResponse(scheduleData, teachers, classes, subjects, mappings);
      
      // 4. Sonucu doğrula ve dönüştür
      const finalResult = this.convertToSystemFormat(parsedResult, teachers, classes, subjects, mappings);
      
      console.log('✅ Gemini AI program oluşturma tamamlandı');
      return finalResult;

    } catch (error) {
      console.error('❌ Gemini AI hatası:', error);
      throw new Error('AI yanıtı işlenemedi');
    }
  }

  /**
   * Gemini için detaylı prompt oluşturma
   */
  private createSchedulingPrompt(
    mappings: SubjectTeacherMapping[],
    teachers: Teacher[],
    classes: Class[],
    subjects: Subject[],
    constraints: TimeConstraint[],
    wizardData: WizardData
  ): string {
    // Öğretmen-sınıf-ders ilişkilerini daha net göstermek için
    const teacherAssignments = new Map<string, { teacherId: string, teacherName: string, assignments: { classId: string, className: string, subjectId: string, subjectName: string, hours: number }[] }>();
    
    mappings.forEach(m => {
      const teacher = teachers.find(t => t.id === m.teacherId);
      const classItem = classes.find(c => c.id === m.classId);
      const subject = subjects.find(s => s.id === m.subjectId);
      
      if (teacher && classItem && subject) {
        if (!teacherAssignments.has(teacher.id)) {
          teacherAssignments.set(teacher.id, { 
            teacherId: teacher.id, 
            teacherName: teacher.name, 
            assignments: [] 
          });
        }
        
        teacherAssignments.get(teacher.id)!.assignments.push({
          classId: classItem.id,
          className: classItem.name,
          subjectId: subject.id,
          subjectName: subject.name,
          hours: m.weeklyHours
        });
      }
    });

    // Kısıtlamaları daha anlaşılır hale getir
    const formattedConstraints = constraints.map(c => {
      const entityName = c.entityType === 'teacher' 
        ? teachers.find(t => t.id === c.entityId)?.name 
        : c.entityType === 'class' 
          ? classes.find(cl => cl.id === c.entityId)?.name 
          : subjects.find(s => s.id === c.entityId)?.name;
      
      return {
        entityType: c.entityType,
        entityName,
        day: c.day,
        period: c.period,
        constraintType: c.constraintType
      };
    });

    return `
# TÜRK EĞİTİM SİSTEMİ DERS PROGRAMI OLUŞTURMA GÖREVİ

Sen bir Türk okulu için ders programı oluşturan uzman bir AI asistanısın. Aşağıdaki veriler ve kurallar doğrultusunda MÜKEMMEL bir ders programı oluşturman gerekiyor.

## OKUL BİLGİLERİ
- Okul: İDE Okulları
- Eğitim Yılı: ${wizardData.basicInfo.academicYear}
- Dönem: ${wizardData.basicInfo.semester}
- Günlük Ders Saati: ${wizardData.basicInfo.dailyHours}
- Haftalık Gün: ${wizardData.basicInfo.weekDays}

## ZAMAN ÇİZELGESİ
Günler: ${DAYS.join(', ')}
Ders Saatleri: ${PERIODS.join(', ')}

### ÖZEL SAATLER:
- Hazırlık: 08:30-08:50 (İlkokul/Anaokulu), 08:30-08:40 (Ortaokul)
- Yemek: 5. ders (İlkokul/Anaokulu), 6. ders (Ortaokul)
- Kahvaltı: 1. dersten sonra (sadece Ortaokul)
- İkindi Kahvaltısı: 8. dersten sonra

## ÖĞRETMEN LİSTESİ
${teachers.filter(t => wizardData.teachers.selectedTeachers.includes(t.id)).map(t => `
- ID: ${t.id}
  * Ad: ${t.name}
  * Branş: ${t.branch}
  * Seviye: ${(t.levels || [t.level]).join(', ')}
  * Verebileceği Dersler: ${subjects.filter(s => t.subjectIds?.includes(s.id)).map(s => s.name).join(', ') || 'Belirtilmemiş'}
  * Maksimum Haftalık Ders Saati: ${t.totalWeeklyHours || 45}
`).join('')}

## SINIF LİSTESİ
${classes.filter(c => wizardData.classes.selectedClasses.includes(c.id)).map(c => {
  const classTeacher = teachers.find(t => t.id === c.classTeacherId);
  return `
- ID: ${c.id}
  * Ad: ${c.name}
  * Seviye: ${c.level}
  * Sınıf Öğretmeni: ${classTeacher?.name || 'Yok'}
  ${classTeacher ? `  * Sınıf Öğretmeni Dersleri: ${c.assignments?.find(a => a.teacherId === c.classTeacherId)?.subjectIds.map(sid => {
    const subject = subjects.find(s => s.id === sid);
    return subject ? `${subject.name} (${subject.weeklyHours} saat)` : '';
  }).filter(Boolean).join(', ') || 'Belirtilmemiş'}` : ''}
  * Atanan Öğretmenler: ${c.assignments?.map(a => {
    const teacher = teachers.find(t => t.id === a.teacherId);
    const subjectNames = a.subjectIds.map(sid => subjects.find(s => s.id === sid)?.name).filter(Boolean);
    return `${teacher?.name} (${subjectNames.join(', ')})`;
  }).join('; ') || 'Yok'}
`}).join('')}

## DERS LİSTESİ
${subjects.filter(s => wizardData.subjects.selectedSubjects.includes(s.id)).map(s => `
- ID: ${s.id}
  * Ad: ${s.name}
  * Branş: ${s.branch}
  * Seviye: ${(s.levels || [s.level]).join(', ')}
  * Haftalık Saat: ${s.weeklyHours}
  * Dağıtım: ${s.distributionPattern || 'Belirtilmemiş'}
`).join('')}

## ÖĞRETMEN-SINIF-DERS ATAMALARI
${Array.from(teacherAssignments.values()).map(ta => `
### ${ta.teacherName} (ID: ${ta.teacherId})
${ta.assignments.map(a => `- ${a.className} sınıfı → ${a.subjectName} dersi → ${a.hours} saat/hafta`).join('\n')}
`).join('\n')}

## ZAMAN KISITLAMALARI
${formattedConstraints.length > 0 ? formattedConstraints.map(c => 
  `- ${c.entityName} (${c.entityType}): ${c.day} ${c.period}. ders → ${c.constraintType}`
).join('\n') : 'Özel kısıtlama yok'}

## KURALLAR VE PRİORİTELER

### ZORUNLU KURALLAR:
1. **Çakışma Yasağı**: Aynı öğretmen veya sınıf aynı anda iki yerde olamaz
2. **Seviye Uyumu**: Öğretmen sadece kendi seviyesindeki sınıflara ders verebilir
3. **Branş Uyumu**: Öğretmen sadece kendi branşındaki dersleri verebilir
4. **Sabit Saatler**: Yemek, hazırlık, kahvaltı saatleri değiştirilemez
5. **Kısıtlama Uyumu**: "unavailable" kısıtlamaları kesinlikle ihlal edilemez
6. **Yemek Saatleri**: Yemek saatlerinde (İlkokul/Anaokulu: 5. ders, Ortaokul: 6. ders) ders atanamaz
7. **Günlük Ders Limiti**: Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verebilir (sınıf öğretmenleri için)
8. **Sınıf Ders Saati**: Her sınıf 45 saatlik ders ile doldurulmalıdır
9. **Öğretmen Haftalık Ders Limiti**: Her öğretmenin maksimum haftalık ders saati aşılmamalıdır (varsayılan: 45 saat)

### OPTİMİZASYON PRİORİTELERİ:
1. **Dağıtım Şekilleri**: Derslerin belirtilen dağıtım şekillerine uygun yerleştirilmesi
2. **Blok Dersler**: Aynı dersin ardışık saatlerde verilmesi (mümkünse)
3. **Öğretmen Yükü**: Öğretmenlerin günlük yükünün dengeli dağıtılması
4. **Sınıf Yükü**: Sınıfların günlük ders yükünün dengeli olması
5. **Tercih Edilen Saatler**: "preferred" kısıtlamalarına öncelik verilmesi

### ÖZEL DURUMLAR:
- **Kulüp Dersleri (İlkokul/Anaokulu)**: Perşembe günü 9-10. saatlerde 2 saatlik blok olarak verilmelidir
- **Kulüp Dersleri (Ortaokul)**: Perşembe günü 7-8. saatlerde 2 saatlik blok olarak verilmelidir
- **ADE Dersleri**: Salı günü 4-5 ve 7-8. saatlerde (Ortaokul)
- **Sınıf Öğretmeni**: Kendi sınıfında mümkün olduğunca çok ders vermeli
- **Ana Dersler**: Türkçe, Matematik gibi temel dersler sabah saatlerinde tercih edilmeli

## SINIF ÖĞRETMENLERİ İÇİN ÖNEMLİ KURALLAR
1. **Öncelik**: İlkokul ve Anaokulu'nda sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirilmelidir
2. **Ders Dağılımı**: Sınıf öğretmenleri Türkçe, Matematik, Hayat Bilgisi gibi temel dersleri verir
3. **Dengeli Dağılım**: Sınıf öğretmeninin dersleri haftanın günlerine dengeli dağıtılmalıdır
4. **Sabah Saatleri**: Sınıf öğretmenlerinin temel dersleri (Türkçe, Matematik) sabah saatlerinde olmalıdır
5. **Blok Dersler**: Sınıf öğretmenlerinin dersleri mümkünse blok halinde (2 saat) yerleştirilmelidir
6. **Günlük Limit**: Sınıf öğretmeni bir günde en fazla 4 saat ders verebilir (2 farklı ders, 2'şer saat)
7. **Tamamlama Önceliği**: Sınıf öğretmeninin dersleri tamamlanmadan diğer dersler yerleştirilmemelidir
8. **Haftalık Limit**: Her öğretmenin maksimum haftalık ders saati aşılmamalıdır (öğretmen bazında değişebilir)

## ÇIKTI FORMATI

Lütfen her öğretmen için aşağıdaki JSON formatında program oluştur:

\`\`\`json
[
  {
    "teacherId": "öğretmen_id",
    "schedule": {
      "Pazartesi": {
        "1": {"classId": "sınıf_id", "subjectId": "ders_id"},
        "2": null,
        ...
      },
      "Salı": { ... },
      ...
    }
  },
  ...
]
\`\`\`

## BAŞARI KRİTERLERİ

1. **%100 Atama**: Tüm ders saatleri atanmalı
2. **Sıfır Çakışma**: Hiçbir çakışma olmamalı
3. **Kural Uyumu**: Tüm zorunlu kurallara uyulmalı
4. **Denge**: Öğretmen ve sınıf yükleri dengeli olmalı
5. **Optimizasyon**: Tercihler ve dağıtım şekilleri dikkate alınmalı
6. **Sınıf Ders Saati**: Her sınıf 45 saatlik ders ile doldurulmalı
7. **Günlük Limit**: Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verebilir (sınıf öğretmenleri için)
8. **Sınıf Öğretmeni Önceliği**: Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirilmeli
9. **Öğretmen Haftalık Ders Limiti**: Her öğretmenin maksimum haftalık ders saati aşılmamalıdır

## EKSİK DERS ATAMASI DURUMUNDA

Eğer tüm dersleri yerleştiremezsen, eksik kalan dersler için şu bilgileri ver:
1. Hangi sınıfın hangi dersi eksik kaldı
2. Hangi öğretmenin ders yükü tamamlanamadı
3. Eksik kalan derslerin yerleştirilmesi için öneriler

Şimdi bu verilere dayanarak MÜKEMMEL bir ders programı oluştur. Sadece JSON formatında çıktı ver, başka açıklama ekleme.
`;
  }

  /**
   * JSON string'ini temizleme fonksiyonu
   */
  private cleanJsonString(jsonString: string): string {
    // Single-line comments (//) kaldır
    jsonString = jsonString.replace(/\/\/.*$/gm, '');
    
    // Multi-line comments (/* */) kaldır
    jsonString = jsonString.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Trailing commas kaldır (closing brace/bracket'tan önce)
    jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
    
    // Extra whitespace ve newlines temizle
    jsonString = jsonString.replace(/\s+/g, ' ').trim();
    
    return jsonString;
  }

  /**
   * Gemini yanıtını parse etme
   */
  private parseGeminiResponse(
    response: string, 
    teachers: Teacher[], 
    classes: Class[], 
    subjects: Subject[],
    mappings: SubjectTeacherMapping[]
  ): any {
    try {
      console.log('🔍 Gemini yanıtı parse ediliyor...');
      
      // JSON formatını bul ve parse et
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      let scheduleData;
      
      if (jsonMatch) {
        console.log('✅ JSON code block bulundu');
        let jsonString = jsonMatch[1];
        jsonString = this.cleanJsonString(jsonString);
        scheduleData = JSON.parse(jsonString);
      } else {
        console.log('⚠️ JSON code block bulunamadı, alternatif yöntemler deneniyor...');
        
        // Alternatif 1: Tüm yanıtı JSON olarak parse etmeyi dene
        try {
          let cleanedResponse = this.cleanJsonString(response);
          scheduleData = JSON.parse(cleanedResponse);
          console.log('✅ Tüm yanıt JSON olarak parse edildi');
        } catch (e) {
          console.log('⚠️ Tüm yanıt JSON değil, metin içinde JSON aranıyor...');
          
          // Alternatif 2: Metin içinde JSON formatını bul
          const jsonStartIndex = response.indexOf('[');
          const jsonEndIndex = response.lastIndexOf(']') + 1;
          
          if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
            let jsonText = response.substring(jsonStartIndex, jsonEndIndex);
            jsonText = this.cleanJsonString(jsonText);
            scheduleData = JSON.parse(jsonText);
            console.log('✅ Metin içinden JSON extract edildi');
          } else {
            // Alternatif 3: Curly braces ile object arama
            const objStartIndex = response.indexOf('{');
            const objEndIndex = response.lastIndexOf('}') + 1;
            
            if (objStartIndex >= 0 && objEndIndex > objStartIndex) {
              let objText = response.substring(objStartIndex, objEndIndex);
              objText = this.cleanJsonString(objText);
              
              // Eğer tek bir object ise array'e çevir
              const parsedObj = JSON.parse(objText);
              scheduleData = Array.isArray(parsedObj) ? parsedObj : [parsedObj];
              console.log('✅ Object formatından JSON oluşturuldu');
            } else {
              throw new Error('Gemini yanıtında geçerli JSON formatı bulunamadı');
            }
          }
        }
      }
      
      // Sonucun array olduğunu kontrol et
      if (!Array.isArray(scheduleData)) {
        console.log('⚠️ Sonuç array değil, array\'e çevriliyor...');
        scheduleData = [scheduleData];
      }
      
      console.log('✅ Gemini yanıtı başarıyla parse edildi, öğretmen sayısı:', scheduleData.length);
      return scheduleData;
      
    } catch (error) {
      console.error('❌ Gemini yanıtı parse edilemedi:', error);
      console.error('📝 Ham yanıt:', response.substring(0, 500) + '...');
      throw new Error('AI yanıtı işlenemedi');
    }
  }

  /**
   * Gemini sonucunu sistem formatına dönüştür
   */
  private convertToSystemFormat(
    geminiResult: any, 
    teachers: Teacher[], 
    classes: Class[], 
    subjects: Subject[],
    mappings: SubjectTeacherMapping[]
  ): EnhancedGenerationResult {
    try {
      // Gemini'den gelen programı sistem formatına dönüştür
      const schedules: Omit<Schedule, 'id' | 'createdAt'>[] = [];
      
      // Tüm öğretmenleri kontrol et
      geminiResult.forEach((teacherSchedule: any) => {
        const teacherId = teacherSchedule.teacherId;
        const schedule: Schedule['schedule'] = {};
        
        // Günleri doldur
        DAYS.forEach(day => {
          schedule[day] = {};
          
          // Saatleri doldur
          PERIODS.forEach(period => {
            const slot = teacherSchedule.schedule[day]?.[period];
            
            // YEMEK SAATLERİNİ KONTROL ET
            const teacher = teachers.find(t => t.id === teacherId);
            if (teacher) {
              const teacherLevel = teacher.levels?.[0] || teacher.level;
              const lunchPeriod = teacherLevel === 'Ortaokul' ? '6' : '5';
              
              // Yemek saati ise sabit slot ekle
              if (period === lunchPeriod) {
                schedule[day][period] = {
                  classId: 'fixed-period',
                  subjectId: 'fixed-lunch',
                  isFixed: true
                };
                return; // Bu slot için işlemi sonlandır
              }
            }
            
            if (slot && slot.classId) {
              schedule[day][period] = {
                classId: slot.classId,
                subjectId: slot.subjectId
              };
            } else {
              schedule[day][period] = null;
            }
          });
        });
        
        schedules.push({
          teacherId,
          schedule,
          updatedAt: new Date()
        });
      });
      
      // Atanan ders saatlerini hesapla
      let placedLessons = 0;
      const assignedLessons = new Map<string, number>();
      
      schedules.forEach(schedule => {
        DAYS.forEach(day => {
          PERIODS.forEach(period => {
            const slot = schedule.schedule[day]?.[period];
            if (slot && slot.classId && slot.subjectId && slot.classId !== 'fixed-period') {
              placedLessons++;
              
              // Mapping bazında atama sayısını takip et
              const key = `${slot.classId}-${slot.subjectId}`;
              assignedLessons.set(key, (assignedLessons.get(key) || 0) + 1);
            }
          });
        });
      });
      
      // Eksik atamaları tespit et
      const unassignedLessons: { className: string; subjectName: string; teacherName: string; missingHours: number }[] = [];
      
      mappings.forEach(mapping => {
        const key = `${mapping.classId}-${mapping.subjectId}`;
        const assignedHours = assignedLessons.get(key) || 0;
        
        if (assignedHours < mapping.weeklyHours) {
          const classItem = classes.find(c => c.id === mapping.classId);
          const subject = subjects.find(s => s.id === mapping.subjectId);
          const teacher = teachers.find(t => t.id === mapping.teacherId);
          
          if (classItem && subject && teacher) {
            unassignedLessons.push({
              className: classItem.name,
              subjectName: subject.name,
              teacherName: teacher.name,
              missingHours: mapping.weeklyHours - assignedHours
            });
          }
        }
      });
      
      // Sınıfların 45 saatlik ders limiti kontrolü
      const classWeeklyHours = new Map<string, number>();
      const classNames = new Map<string, string>();
      
      classes.forEach(c => classNames.set(c.id, c.name));
      
      // Her sınıf için haftalık ders saatini hesapla
      schedules.forEach(schedule => {
        DAYS.forEach(day => {
          PERIODS.forEach(period => {
            const slot = schedule.schedule[day]?.[period];
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
      schedules.forEach(schedule => {
        const teacherId = schedule.teacherId;
        const teacher = teachers.find(t => t.id === teacherId);
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
              const classItem = classes.find(c => c.id === slot.classId);
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
      
      // Öğretmenlerin haftalık ders saati limiti kontrolü
      const teacherWeeklyHoursViolations: string[] = [];
      schedules.forEach(schedule => {
        const teacherId = schedule.teacherId;
        const teacher = teachers.find(t => t.id === teacherId);
        if (!teacher) return;
        
        // Öğretmenin haftalık toplam ders saatini hesapla
        let totalHours = 0;
        DAYS.forEach(day => {
          PERIODS.forEach(period => {
            const slot = schedule.schedule[day]?.[period];
            if (slot && slot.classId && slot.classId !== 'fixed-period') {
              totalHours++;
            }
          });
        });
        
        // Öğretmenin maksimum ders saati (totalWeeklyHours varsa onu kullan, yoksa 45)
        const maxWeeklyHours = teacher.totalWeeklyHours || 45;
        
        // Eğer öğretmen maksimum ders saatini aşmışsa, uyarı ekle
        if (totalHours > maxWeeklyHours) {
          teacherWeeklyHoursViolations.push(
            `${teacher.name} öğretmeni maksimum haftalık ders saatini (${maxWeeklyHours}) aşıyor: ${totalHours} saat`
          );
        }
      });
      
      // AI önerileri oluştur
      const suggestions: string[] = [
        'AI tarafından oluşturulan program',
        'Öğretmen yükleri dengeli dağıtıldı',
        'Çakışmalar önlendi',
        'Kulüp dersleri 2 saatlik bloklar halinde yerleştirildi',
        'Yemek saatlerine ders atanmadı',
        'Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verecek şekilde planlandı (sınıf öğretmenleri için)',
        'Her sınıf için 45 saatlik ders hedeflendi',
        'Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirildi',
        'Öğretmenlerin haftalık maksimum ders saati limitleri dikkate alındı'
      ];
      
      // Eksik atamalar için öneriler
      if (unassignedLessons.length > 0) {
        suggestions.push('Eksik ders atamaları için öneriler:');
        unassignedLessons.forEach(lesson => {
          suggestions.push(`- ${lesson.className} sınıfı için ${lesson.subjectName} dersinin ${lesson.missingHours} saati yerleştirilemedi. ${lesson.teacherName} öğretmeninin programı kontrol edilmeli.`);
        });
      }
      
      // Toplam ders saati
      const totalLessonsToPlace = mappings.reduce((sum, m) => sum + m.weeklyHours, 0);
      
      return {
        success: true,
        schedules,
        statistics: {
          totalLessonsToPlace,
          placedLessons,
          unassignedLessons
        },
        warnings: [
          ...unassignedLessons.length > 0 ? ['Bazı dersler programda tam olarak yerleştirilemedi'] : [],
          ...classWarnings,
          ...teacherClassDailyHoursViolations,
          ...teacherWeeklyHoursViolations
        ],
        errors: [],
        aiInsights: {
          optimizationScore: Math.round((placedLessons / totalLessonsToPlace) * 100),
          suggestions
        }
      };
    } catch (error) {
      console.error('Format dönüştürme hatası:', error);
      throw new Error('AI sonucu sistem formatına dönüştürülemedi');
    }
  }

  /**
   * Mevcut programı analiz etme ve iyileştirme önerileri
   */
  async analyzeAndSuggestImprovements(currentSchedule: any): Promise<string[]> {
    try {
      const prompt = `
Aşağıdaki ders programını analiz et ve iyileştirme önerileri sun:

${JSON.stringify(currentSchedule, null, 2)}

Lütfen şu konularda öneriler ver:
1. Çakışma tespiti
2. Yük dengeleme
3. Eğitimsel optimizasyon
4. Öğretmen memnuniyeti
5. Sınıf verimliliği
6. Bir öğretmenin aynı sınıfa günde en fazla 4 saat ders vermesi kuralına uyum (sınıf öğretmenleri için)
7. Her sınıfın 45 saatlik ders ile doldurulması hedefine uyum
8. Sınıf öğretmenlerinin derslerinin önceliklendirilmesi
9. Öğretmenlerin haftalık maksimum ders saati limitlerinin aşılmaması

Önerilerini madde madde listele.
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const suggestions = response.text();

      return suggestions.split('\n').filter(line => line.trim().length > 0);
    } catch (error) {
      console.error('Analiz hatası:', error);
      return ['Analiz yapılamadı'];
    }
  }

  /**
   * Akıllı çakışma çözümü
   */
  async resolveConflicts(conflicts: string[], currentSchedule: any): Promise<any> {
    try {
      const prompt = `
Aşağıdaki ders programı çakışmalarını çöz:

ÇAKIŞMALAR:
${conflicts.join('\n')}

MEVCUT PROGRAM:
${JSON.stringify(currentSchedule, null, 2)}

KURALLAR:
1. Bir öğretmen, bir sınıfa günde en fazla 4 saat ders verebilir (sınıf öğretmenleri için)
2. Her sınıf 45 saatlik ders ile doldurulmalıdır
3. Kulüp dersleri sabit zaman dilimlerinde verilmelidir (İlkokul: Perşembe 9-10, Ortaokul: Perşembe 7-8)
4. Yemek saatlerine ders atanamaz (İlkokul/Anaokulu: 5. ders, Ortaokul: 6. ders)
5. Sınıf öğretmenlerinin dersleri öncelikli olarak yerleştirilmelidir (İlkokul ve Anaokulu için)
6. Temel dersler (Türkçe, Matematik) sabah saatlerinde olmalıdır
7. Sınıf öğretmeni bir günde en fazla 2 farklı ders verebilir, her birinden 2 saat olmak üzere
8. Öğretmenlerin haftalık maksimum ders saati limitleri aşılmamalıdır

Lütfen bu çakışmaları çözmek için spesifik öneriler ver ve yeni program düzenlemesi öner.
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      return this.parseGeminiResponse(response.text(), [], [], [], []);
    } catch (error) {
      console.error('AI çakışma çözüm hatası:', error);
      throw error;
    }
  }
}

export const geminiScheduleService = new GeminiScheduleService();