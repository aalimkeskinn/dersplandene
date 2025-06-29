import { Subject, DAYS, PERIODS } from '../types';
import { TimeConstraint } from '../types/constraints';

/**
 * Sabit kısıtlamalar - Sistem tarafından otomatik uygulanır
 * Bu kısıtlamalar kullanıcı tarafından değiştirilemez
 */
export const FIXED_CONSTRAINTS: TimeConstraint[] = [
  // İlkokul Kulüp Dersi - Perşembe 9-10. ders saatleri
  {
    id: 'fixed-ilkokul-kulup-1',
    entityType: 'subject',
    entityId: 'kulup-ilkokul',
    day: 'Perşembe',
    period: '9',
    constraintType: 'preferred',
    reason: 'İlkokul Kulüp Dersi - Sabit Zaman',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'fixed-ilkokul-kulup-2',
    entityType: 'subject',
    entityId: 'kulup-ilkokul',
    day: 'Perşembe',
    period: '10',
    constraintType: 'preferred',
    reason: 'İlkokul Kulüp Dersi - Sabit Zaman',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  
  // Ortaokul Kulüp Dersi - Perşembe 7-8. ders saatleri
  {
    id: 'fixed-ortaokul-kulup-1',
    entityType: 'subject',
    entityId: 'kulup-ortaokul',
    day: 'Perşembe',
    period: '7',
    constraintType: 'preferred',
    reason: 'Ortaokul Kulüp Dersi - Sabit Zaman',
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'fixed-ortaokul-kulup-2',
    entityType: 'subject',
    entityId: 'kulup-ortaokul',
    day: 'Perşembe',
    period: '8',
    constraintType: 'preferred',
    reason: 'Ortaokul Kulüp Dersi - Sabit Zaman',
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

/**
 * Kulüp derslerini tespit eder ve sabit kısıtlamaları uygular
 * @param subjects Tüm dersler
 * @param existingConstraints Mevcut kısıtlamalar
 * @returns Güncellenmiş kısıtlamalar
 */
export function applyFixedClubConstraints(
  subjects: { id: string; name: string; level?: string; levels?: string[] }[],
  existingConstraints: TimeConstraint[]
): TimeConstraint[] {
  // Mevcut kısıtlamaların kopyasını oluştur
  const updatedConstraints = [...existingConstraints];
  
  // Kulüp derslerini tespit et
  const ilkokulKulupDersleri = subjects.filter(s => 
    s.name.toUpperCase().includes('KULÜP') && 
    (s.level === 'İlkokul' || (s.levels && s.levels.includes('İlkokul')))
  );
  
  const ortaokulKulupDersleri = subjects.filter(s => 
    s.name.toUpperCase().includes('KULÜP') && 
    (s.level === 'Ortaokul' || (s.levels && s.levels.includes('Ortaokul')))
  );
  
  console.log(`🔍 Kulüp dersleri tespit edildi: İlkokul=${ilkokulKulupDersleri.length}, Ortaokul=${ortaokulKulupDersleri.length}`);
  
  // İlkokul kulüp dersleri için kısıtlamalar
  ilkokulKulupDersleri.forEach(subject => {
    // Perşembe 9-10. ders saatleri dışındaki tüm saatleri 'unavailable' yap
    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        // Perşembe 9-10. ders saatleri hariç tüm saatler için kısıtlama ekle
        if (!(day === 'Perşembe' && (period === '9' || period === '10'))) {
          const constraintId = `fixed-ilkokul-kulup-${subject.id}-${day}-${period}`;
          
          // Eğer bu kısıtlama zaten varsa güncelle, yoksa ekle
          const existingIndex = updatedConstraints.findIndex(c => 
            c.entityType === 'subject' && 
            c.entityId === subject.id && 
            c.day === day && 
            c.period === period
          );
          
          if (existingIndex !== -1) {
            updatedConstraints[existingIndex] = {
              ...updatedConstraints[existingIndex],
              constraintType: 'unavailable',
              reason: 'İlkokul Kulüp Dersi - Sabit Zaman Kısıtlaması',
              updatedAt: new Date()
            };
          } else {
            updatedConstraints.push({
              id: constraintId,
              entityType: 'subject',
              entityId: subject.id,
              day,
              period,
              constraintType: 'unavailable',
              reason: 'İlkokul Kulüp Dersi - Sabit Zaman Kısıtlaması',
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        }
      });
    });
    
    // Perşembe 9-10. ders saatlerini 'preferred' yap
    ['9', '10'].forEach(period => {
      const constraintId = `fixed-ilkokul-kulup-${subject.id}-Perşembe-${period}`;
      
      const existingIndex = updatedConstraints.findIndex(c => 
        c.entityType === 'subject' && 
        c.entityId === subject.id && 
        c.day === 'Perşembe' && 
        c.period === period
      );
      
      if (existingIndex !== -1) {
        updatedConstraints[existingIndex] = {
          ...updatedConstraints[existingIndex],
          constraintType: 'preferred',
          reason: 'İlkokul Kulüp Dersi - Sabit Zaman',
          updatedAt: new Date()
        };
      } else {
        updatedConstraints.push({
          id: constraintId,
          entityType: 'subject',
          entityId: subject.id,
          day: 'Perşembe',
          period,
          constraintType: 'preferred',
          reason: 'İlkokul Kulüp Dersi - Sabit Zaman',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    });
  });
  
  // Ortaokul kulüp dersleri için kısıtlamalar
  ortaokulKulupDersleri.forEach(subject => {
    // Perşembe 7-8. ders saatleri dışındaki tüm saatleri 'unavailable' yap
    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        // Perşembe 7-8. ders saatleri hariç tüm saatler için kısıtlama ekle
        if (!(day === 'Perşembe' && (period === '7' || period === '8'))) {
          const constraintId = `fixed-ortaokul-kulup-${subject.id}-${day}-${period}`;
          
          // Eğer bu kısıtlama zaten varsa güncelle, yoksa ekle
          const existingIndex = updatedConstraints.findIndex(c => 
            c.entityType === 'subject' && 
            c.entityId === subject.id && 
            c.day === day && 
            c.period === period
          );
          
          if (existingIndex !== -1) {
            updatedConstraints[existingIndex] = {
              ...updatedConstraints[existingIndex],
              constraintType: 'unavailable',
              reason: 'Ortaokul Kulüp Dersi - Sabit Zaman Kısıtlaması',
              updatedAt: new Date()
            };
          } else {
            updatedConstraints.push({
              id: constraintId,
              entityType: 'subject',
              entityId: subject.id,
              day,
              period,
              constraintType: 'unavailable',
              reason: 'Ortaokul Kulüp Dersi - Sabit Zaman Kısıtlaması',
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        }
      });
    });
    
    // Perşembe 7-8. ders saatlerini 'preferred' yap
    ['7', '8'].forEach(period => {
      const constraintId = `fixed-ortaokul-kulup-${subject.id}-Perşembe-${period}`;
      
      const existingIndex = updatedConstraints.findIndex(c => 
        c.entityType === 'subject' && 
        c.entityId === subject.id && 
        c.day === 'Perşembe' && 
        c.period === period
      );
      
      if (existingIndex !== -1) {
        updatedConstraints[existingIndex] = {
          ...updatedConstraints[existingIndex],
          constraintType: 'preferred',
          reason: 'Ortaokul Kulüp Dersi - Sabit Zaman',
          updatedAt: new Date()
        };
      } else {
        updatedConstraints.push({
          id: constraintId,
          entityType: 'subject',
          entityId: subject.id,
          day: 'Perşembe',
          period,
          constraintType: 'preferred',
          reason: 'Ortaokul Kulüp Dersi - Sabit Zaman',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    });
  });
  
  // Yemek saatleri için kısıtlamalar ekle
  // İlkokul/Anaokulu için 5. ders, Ortaokul için 6. ders
  subjects.forEach(subject => {
    const subjectLevels = subject.levels || [subject.level];
    
    // İlkokul/Anaokulu dersleri için 5. ders saatini 'unavailable' yap
    if (subjectLevels.includes('İlkokul') || subjectLevels.includes('Anaokulu')) {
      DAYS.forEach(day => {
        const constraintId = `fixed-lunch-${subject.id}-${day}-5`;
        
        const existingIndex = updatedConstraints.findIndex(c => 
          c.entityType === 'subject' && 
          c.entityId === subject.id && 
          c.day === day && 
          c.period === '5'
        );
        
        if (existingIndex !== -1) {
          updatedConstraints[existingIndex] = {
            ...updatedConstraints[existingIndex],
            constraintType: 'unavailable',
            reason: 'Yemek Saati - Ders Atanamaz',
            updatedAt: new Date()
          };
        } else {
          updatedConstraints.push({
            id: constraintId,
            entityType: 'subject',
            entityId: subject.id,
            day,
            period: '5',
            constraintType: 'unavailable',
            reason: 'Yemek Saati - Ders Atanamaz',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      });
    }
    
    // Ortaokul dersleri için 6. ders saatini 'unavailable' yap
    if (subjectLevels.includes('Ortaokul')) {
      DAYS.forEach(day => {
        const constraintId = `fixed-lunch-${subject.id}-${day}-6`;
        
        const existingIndex = updatedConstraints.findIndex(c => 
          c.entityType === 'subject' && 
          c.entityId === subject.id && 
          c.day === day && 
          c.period === '6'
        );
        
        if (existingIndex !== -1) {
          updatedConstraints[existingIndex] = {
            ...updatedConstraints[existingIndex],
            constraintType: 'unavailable',
            reason: 'Yemek Saati - Ders Atanamaz',
            updatedAt: new Date()
          };
        } else {
          updatedConstraints.push({
            id: constraintId,
            entityType: 'subject',
            entityId: subject.id,
            day,
            period: '6',
            constraintType: 'unavailable',
            reason: 'Yemek Saati - Ders Atanamaz',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      });
    }
  });
  
  return updatedConstraints;
}