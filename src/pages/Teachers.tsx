import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Users, Search, X, BookOpen, Clock } from 'lucide-react';
import { Teacher, EDUCATION_LEVELS, Subject, Schedule, Class } from '../types';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import Select from '../components/UI/Select';
import ConfirmationModal from '../components/UI/ConfirmationModal';

const Teachers = () => {
  const { data: teachers, loading, add, update, remove } = useFirestore<Teacher>('teachers');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { data: schedules } = useFirestore<Schedule>('schedules');
  // *** YENİ: Öğretmenlerin görev yükünü doğru hesaplamak için sınıf verileri eklendi.
  const { data: classes } = useFirestore<Class>('classes');
  const { success, error, warning } = useToast();
  const { 
    confirmation, 
    showConfirmation, 
    hideConfirmation,
    confirmDelete 
  } = useConfirmation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [levelFilter, setLevelFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [bulkTeachers, setBulkTeachers] = useState([
    { name: '', branch: '', level: '' }
  ]);
  
  const [formData, setFormData] = useState({
    name: '',
    branch: '',
    levels: [] as ('Anaokulu' | 'İlkokul' | 'Ortaokul')[],
    subjectIds: [] as string[],
    totalWeeklyHours: '45', // YENİ: Varsayılan haftalık ders saati
  });

  useEffect(() => {
    if (formData.subjectIds.length > 0) {
      const stillValidSubjectIds = formData.subjectIds.filter(subjectId => {
        const subject = subjects.find(s => s.id === subjectId);
        if (!subject) return false;

        const subjectLevels = subject.levels || [subject.level];
        return subjectLevels.some(sl => formData.levels.includes(sl));
      });

      if (stillValidSubjectIds.length < formData.subjectIds.length) {
        setFormData(prev => ({
          ...prev,
          subjectIds: stillValidSubjectIds
        }));
      }
    }
  }, [formData.levels, subjects, formData.subjectIds]);

  const getUniqueBranches = () => {
    const branches = [...new Set(subjects.map(subject => subject.branch))];
    return branches.sort((a, b) => a.localeCompare(b, 'tr'));
  };

  const getFilteredTeachers = () => {
    return teachers.filter(teacher => {
      const teacherLevels = teacher.levels || [teacher.level];
      const teacherBranches = teacher.branches || teacher.branch.split(',').map(b => b.trim());
      const matchesLevel = !levelFilter || teacherLevels.includes(levelFilter as any);
      const matchesBranch = !branchFilter || teacherBranches.includes(branchFilter);
      const matchesSearch = !searchQuery || 
        teacher.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        getTeacherBranchesDisplay(teacher).toLowerCase().includes(searchQuery.toLowerCase());
      return matchesLevel && matchesBranch && matchesSearch;
    });
  };

  const sortedTeachers = getFilteredTeachers().sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  // DÜZELTME: Kulüp öğretmenlerinin ders saatlerini doğru hesaplama
  const getTeacherHoursInClass = (teacherId: string, classId: string): number => {
    const teacherSchedule = schedules.find(s => s.teacherId === teacherId);
    if (!teacherSchedule) return 0;
    
    let hours = 0;
    Object.entries(teacherSchedule.schedule).forEach(([day, daySlots]) => {
      Object.entries(daySlots).forEach(([period, slot]) => {
        if (slot?.classId === classId && !slot.isFixed) {
          hours++;
        }
      });
    });
    return hours;
  };
  
  // DÜZELTME: Kulüp derslerini özel olarak kontrol et - HATA DÜZELTME
  const getTeacherClubHours = (teacherId: string): number => {
    const teacherSchedule = schedules.find(s => s.teacherId === teacherId);
    if (!teacherSchedule) return 0;
    
    let clubHours = 0;
    
    // Perşembe günü 9-10. saatlerde İlkokul kulüp dersleri
    const ilkokulClubSlots = ['9', '10'];
    // Perşembe günü 7-8. saatlerde Ortaokul kulüp dersleri
    const ortaokulClubSlots = ['7', '8'];
    
    // Perşembe gününü kontrol et
    const thursdaySlots = teacherSchedule.schedule['Perşembe'] || {};
    
    // İlkokul kulüp saatlerini kontrol et
    const ilkokulClassesSet = new Set<string>();
    
    ilkokulClubSlots.forEach(period => {
      const slot = thursdaySlots[period];
      if (slot && slot.classId && slot.classId !== 'fixed-period') {
        // Sınıfın seviyesini kontrol et
        const classItem = classes.find(c => c.id === slot.classId);
        if (classItem && (classItem.level === 'İlkokul' || classItem.level === 'Anaokulu')) {
          ilkokulClassesSet.add(slot.classId);
        }
      }
    });
    
    // Her sınıf için 2 saat ekle (blok ders)
    clubHours += ilkokulClassesSet.size * 2;
    
    // Ortaokul kulüp saatlerini kontrol et
    const ortaokulClassesSet = new Set<string>();
    
    ortaokulClubSlots.forEach(period => {
      const slot = thursdaySlots[period];
      if (slot && slot.classId && slot.classId !== 'fixed-period') {
        // Sınıfın seviyesini kontrol et
        const classItem = classes.find(c => c.id === slot.classId);
        if (classItem && classItem.level === 'Ortaokul') {
          ortaokulClassesSet.add(slot.classId);
        }
      }
    });
    
    // Her sınıf için 2 saat ekle (blok ders)
    clubHours += ortaokulClassesSet.size * 2;
    
    return clubHours;
  };
  
  const getTeacherTargetHoursInClass = (teacherId: string, classAssignments: any[]): number => {
    const assignment = classAssignments.find(a => a.teacherId === teacherId);
    if (!assignment) return 0;
    return assignment.subjectIds.reduce((total: number, subjectId: string) => {
      const subject = subjects.find(s => s.id === subjectId);
      return total + (subject?.weeklyHours || 0);
    }, 0);
  };

  // YENİ: Öğretmenin toplam hedef ders saatini hesapla
  const calculateTeacherTotalTargetHours = (teacherId: string): number => {
    let totalHours = 0;
    
    // Tüm sınıflardaki atamalarını kontrol et
    classes.forEach(classItem => {
      if (!classItem.assignments) return;
      
      const assignment = classItem.assignments.find(a => a.teacherId === teacherId);
      if (!assignment) return;
      
      // Bu sınıftaki tüm derslerinin saatlerini topla
      assignment.subjectIds.forEach(subjectId => {
        const subject = subjects.find(s => s.id === subjectId);
        if (subject) {
          totalHours += subject.weeklyHours;
        }
      });
    });
    
    return totalHours;
  };

  const handleDeleteAllTeachers = () => {
    if (teachers.length === 0) {
      warning('⚠️ Silinecek Öğretmen Yok', 'Sistemde silinecek öğretmen bulunamadı');
      return;
    }
    confirmDelete(
      `${teachers.length} Öğretmen`,
      async () => {
        setIsDeletingAll(true);
        try {
          for (const teacher of teachers) {
            await remove(teacher.id);
          }
          success('🗑️ Öğretmenler Silindi', `${teachers.length} öğretmen başarıyla silindi`);
          setLevelFilter('');
          setBranchFilter('');
          setSearchQuery('');
        } catch (err) {
          error('❌ Silme Hatası', 'Öğretmenler silinirken bir hata oluştu');
        } finally {
          setIsDeletingAll(false);
        }
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.branch) { error('❌ Branş Seçimi Gerekli', 'Lütfen bir branş seçin.'); return; }
    if (formData.levels.length === 0) { error('❌ Eğitim Seviyesi Gerekli', 'En az bir eğitim seviyesi seçmelisiniz.'); return; }
    
    // YENİ: Haftalık ders saati kontrolü
    const weeklyHours = parseInt(formData.totalWeeklyHours);
    if (isNaN(weeklyHours) || weeklyHours <= 0 || weeklyHours > 100) {
      error('❌ Geçersiz Haftalık Ders Saati', 'Haftalık ders saati 1-100 arasında olmalıdır.');
      return;
    }
    
    try {
      const teacherData = { 
        name: formData.name, 
        branch: formData.branch, 
        branches: [formData.branch], 
        level: formData.levels[0], 
        levels: formData.levels, 
        subjectIds: formData.subjectIds,
        totalWeeklyHours: weeklyHours // YENİ: Haftalık ders saati
      };
      if (editingTeacher) {
        await update(editingTeacher.id, teacherData);
        success('✅ Öğretmen Güncellendi', `${formData.name} başarıyla güncellendi.`);
      } else {
        await add(teacherData as Omit<Teacher, 'id' | 'createdAt'>);
        success('✅ Öğretmen Eklendi', `${formData.name} başarıyla eklendi.`);
      }
      resetForm();
    } catch (err) {
      error('❌ Hata', 'Öğretmen kaydedilirken bir hata oluştu.');
    }
  };
  
  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validTeachers = bulkTeachers.filter(t => t.name && t.branch && t.level);
    if(validTeachers.length === 0) { error('Hata', 'Lütfen en az bir geçerli öğretmen bilgisi girin.'); return; }
    try {
      for (const teacher of validTeachers) {
        if (EDUCATION_LEVELS.includes(teacher.level as any)) {
          await add({ 
            name: teacher.name, 
            branch: teacher.branch, 
            level: teacher.level as Teacher['level'], 
            branches: [teacher.branch], 
            levels: [teacher.level as 'Anaokulu' | 'İlkokul' | 'Ortaokul'],
            totalWeeklyHours: 45 // YENİ: Varsayılan haftalık ders saati
          } as Omit<Teacher, 'id' | 'createdAt'>);
        }
      }
      setBulkTeachers([{ name: '', branch: '', level: '' }]);
      setIsBulkModalOpen(false);
      success('✅ Öğretmenler Eklendi', `${validTeachers.length} öğretmen başarıyla eklendi`);
    } catch (err) {
      error('❌ Hata', 'Toplu öğretmen eklenirken bir hata oluştu.');
    }
  };

  const resetForm = () => { 
    setFormData({ 
      name: '', 
      branch: '', 
      levels: [], 
      subjectIds: [],
      totalWeeklyHours: '45' // YENİ: Varsayılan haftalık ders saati
    }); 
    setEditingTeacher(null); 
    setIsModalOpen(false); 
  };
  
  const handleEdit = (teacher: Teacher) => { 
    setFormData({ 
      name: teacher.name, 
      branch: teacher.branch, 
      levels: teacher.levels || [teacher.level], 
      subjectIds: teacher.subjectIds || [],
      totalWeeklyHours: teacher.totalWeeklyHours?.toString() || '45' // YENİ: Mevcut haftalık ders saati
    }); 
    setEditingTeacher(teacher); 
    setIsModalOpen(true); 
  };
  
  const handleDelete = async (id: string) => { 
    const teacher = teachers.find(t => t.id === id); 
    if (teacher) { 
      confirmDelete(teacher.name, async () => { 
        await remove(id); 
        success('🗑️ Öğretmen Silindi', `${teacher.name} başarıyla silindi`); 
      }); 
    } 
  };
  
  const handleLevelToggle = (level: 'Anaokulu' | 'İlkokul' | 'Ortaokul') => { 
    setFormData(prev => ({ 
      ...prev, 
      levels: prev.levels.includes(level) ? prev.levels.filter(l => l !== level) : [...prev.levels, level] 
    })); 
  };
  
  const handleSubjectToggle = (subjectId: string) => { 
    setFormData(prev => ({ 
      ...prev, 
      subjectIds: prev.subjectIds.includes(subjectId) ? prev.subjectIds.filter(id => id !== subjectId) : [...prev.subjectIds, subjectId] 
    })); 
  };
  
  const addBulkRow = () => setBulkTeachers([...bulkTeachers, { name: '', branch: '', level: '' }]);
  const removeBulkRow = (index: number) => { if (bulkTeachers.length > 1) setBulkTeachers(bulkTeachers.filter((_, i) => i !== index)); };
  const updateBulkRow = (index: number, field: string, value: string) => { const updated = [...bulkTeachers]; updated[index] = { ...updated[index], [field]: value }; setBulkTeachers(updated); };
  const clearSearch = () => setSearchQuery('');
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') clearSearch(); };
  const getTeacherBranchesDisplay = (teacher: Teacher) => teacher.branch;
  const getTeacherLevelsDisplay = (teacher: Teacher) => teacher.levels || [teacher.level];
  const filteredSubjectsForModal = subjects.filter(subject => { if (formData.levels.length === 0) return false; const subjectLevels = subject.levels || [subject.level]; return subjectLevels.some(sl => formData.levels.includes(sl)); }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const levelOptions = EDUCATION_LEVELS.map(level => ({ value: level, label: level }));
  const branchOptions = [{ value: '', label: 'Branş Seçin...' }, ...getUniqueBranches().map(branch => ({ value: branch, label: branch }))];
  const levelFilterOptions = [{ value: '', label: 'Tüm Seviyeler' }, ...levelOptions];
  const branchFilterOptions = [{ value: '', label: 'Tüm Branşlar' }, ...getUniqueBranches().map(branch => ({ value: branch, label: branch }))];

  if (loading) { return <div className="flex items-center justify-center h-64"><div className="mobile-loading"><div className="mobile-loading-spinner"></div><div className="mobile-loading-text">Yükleniyor...</div></div></div>; }

  return (
    <div className="container-mobile">
      <div className="header-mobile">
        <div className="flex items-center"><Users className="w-8 h-8 text-blue-600 mr-3" /><div><h1 className="text-responsive-xl font-bold text-gray-900">Öğretmenler</h1><p className="text-responsive-sm text-gray-600">{teachers.length} öğretmen kayıtlı ({sortedTeachers.length} gösteriliyor)</p></div></div>
        <div className="button-group-mobile">
          {teachers.length > 0 && <Button onClick={handleDeleteAllTeachers} icon={Trash2} variant="danger" disabled={isDeletingAll} className="w-full sm:w-auto">{isDeletingAll ? 'Siliniyor...' : `Tümünü Sil (${teachers.length})`}</Button>}
          <Button onClick={() => setIsBulkModalOpen(true)} icon={Plus} variant="secondary" className="w-full sm:w-auto">Toplu Ekle</Button>
          <Button onClick={() => setIsModalOpen(true)} icon={Plus} variant="primary" className="w-full sm:w-auto">Yeni Öğretmen</Button>
        </div>
      </div>

      <div className="mobile-card mobile-spacing mb-6">
        <div className="mobile-form-group"><label className="mobile-form-label">🔍 Öğretmen Ara</label><div className="relative"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-5 w-5 text-gray-400" /></div><input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Öğretmen adı veya branş ara... (Enter ile ara)" className="block w-full pl-10 pr-10 py-3 text-base border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200" title="Enter ile ara, ESC ile temizle" />{searchQuery && (<div className="absolute inset-y-0 right-0 pr-3 flex items-center"><button onClick={clearSearch} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" title="Aramayı temizle"><X className="w-5 w-5" /></button></div>)}</div>{searchQuery && (<div className="mt-2 flex items-center justify-between"><p className="text-sm text-blue-600">🔍 "{searchQuery}" için {sortedTeachers.length} sonuç bulundu</p><button onClick={clearSearch} className="text-xs text-gray-500 hover:text-gray-700 underline">Temizle</button></div>)}</div>
        <div className="responsive-grid-2 gap-responsive"><Select label="Seviye Filtresi" value={levelFilter} onChange={setLevelFilter} options={levelFilterOptions} /><Select label="Branş Filtresi" value={branchFilter} onChange={setBranchFilter} options={branchFilterOptions} /></div>
      </div>

      {sortedTeachers.length === 0 ? <div className="text-center py-12 mobile-card"><Users className="w-16 h-16 text-gray-300 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900 mb-2">{teachers.length === 0 ? 'Henüz öğretmen eklenmemiş' : searchQuery ? 'Arama sonucu bulunamadı' : 'Filtrelere uygun öğretmen bulunamadı'}</h3><p className="text-gray-500 mb-4">{teachers.length === 0 ? 'İlk öğretmeninizi ekleyerek başlayın' : searchQuery ? `"${searchQuery}" araması için sonuç bulunamadı` : 'Farklı filtre kriterleri deneyin'}</p></div> : (
        <div className="mobile-card overflow-hidden">
          <div className="table-responsive">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ad Soyad & Yükü</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branş</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Seviye</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">İşlemler</th></tr></thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedTeachers.map((teacher) => {
                  // *** DÜZELTME: Kulüp öğretmenleri için özel hesaplama ***
                  const teacherSchedule = schedules.find(s => s.teacherId === teacher.id);
                  
                  // 1. Gerçekleşen (atanan) saatleri seviyeye göre hesapla
                  const actualHoursByLevel: { [level: string]: number } = {};
                  if (teacherSchedule) {
                    Object.values(teacherSchedule.schedule).forEach(day => {
                      Object.values(day).forEach(slot => {
                        if (slot && !slot.isFixed && slot.classId) {
                          const classItem = classes.find(c => c.id === slot.classId);
                          if (classItem) {
                            const level = classItem.level; // Sınıfın seviyesini al
                            actualHoursByLevel[level] = (actualHoursByLevel[level] || 0) + 1;
                          }
                        }
                      });
                    });
                  }

                  // DÜZELTME: Kulüp dersleri için özel kontrol
                  const isClubTeacher = teacher.name.toUpperCase().includes('KULÜP');
                  const clubHours = getTeacherClubHours(teacher.id);
                  
                  if (isClubTeacher && clubHours > 0) {
                    // Kulüp öğretmeni ve ders ataması var, seviyeye göre ekle
                    const classItems = classes.filter(c => {
                      // Perşembe günü ilgili saatlerde bu öğretmenin atandığı sınıfları bul
                      const teacherSchedule = schedules.find(s => s.teacherId === teacher.id);
                      if (!teacherSchedule) return false;
                      
                      const thursdaySlots = teacherSchedule.schedule['Perşembe'] || {};
                      
                      // İlkokul kulüp saatleri: 9-10
                      if (c.level === 'İlkokul' || c.level === 'Anaokulu') {
                        return thursdaySlots['9']?.classId === c.id || thursdaySlots['10']?.classId === c.id;
                      }
                      
                      // Ortaokul kulüp saatleri: 7-8
                      if (c.level === 'Ortaokul') {
                        return thursdaySlots['7']?.classId === c.id || thursdaySlots['8']?.classId === c.id;
                      }
                      
                      return false;
                    });
                    
                    classItems.forEach(c => {
                      actualHoursByLevel[c.level] = (actualHoursByLevel[c.level] || 0) + 2; // Her sınıf için 2 saat
                    });
                  }

                  // 2. Hedef (görev) saatleri seviyeye göre hesapla
                  const targetHoursByLevel: { [level: string]: number } = {};
                  classes.forEach(classItem => {
                    const teacherAssignment = classItem.assignments?.find(a => a.teacherId === teacher.id);
                    if (teacherAssignment) {
                      teacherAssignment.subjectIds.forEach(subjectId => {
                        const subject = subjects.find(s => s.id === subjectId);
                        if (subject) {
                          const level = classItem.level; // Sınıfın seviyesini al
                          targetHoursByLevel[level] = (targetHoursByLevel[level] || 0) + subject.weeklyHours;
                        }
                      });
                    }
                  });
                  
                  // Gösterilecek tüm seviyeleri birleştir
                  const allLevelsForTeacher = [...new Set([...Object.keys(targetHoursByLevel), ...Object.keys(actualHoursByLevel)])];

                  // Toplam ders saati hesapla
                  const totalActualHours = Object.values(actualHoursByLevel).reduce((sum, hours) => sum + hours, 0);
                  const totalTargetHours = Object.values(targetHoursByLevel).reduce((sum, hours) => sum + hours, 0);
                  
                  // YENİ: Öğretmenin maksimum ders saati kontrolü
                  const maxWeeklyHours = teacher.totalWeeklyHours || 45; // Öğretmenin belirtilen maksimum saati veya varsayılan 45
                  const isOverloaded = totalActualHours > maxWeeklyHours;

                  return (
                    <tr key={teacher.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{teacher.name}</div>
                        {/* Toplam ders saati gösterimi */}
                        <div className={`mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isOverloaded ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          <Clock size={12} className="mr-1" />
                          {totalActualHours} / {totalTargetHours} saat
                          {isOverloaded && <span className="ml-1 text-red-600">⚠️</span>}
                        </div>
                        
                        {/* YENİ: Maksimum ders saati gösterimi */}
                        <div className="mt-1 text-xs text-gray-500">
                          Maksimum: {maxWeeklyHours} saat
                        </div>
                        
                        {/* Seviyeye göre ayrılmış yük gösterimi */}
                        {allLevelsForTeacher.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {allLevelsForTeacher.map(level => {
                              const target = targetHoursByLevel[level as keyof typeof targetHoursByLevel] || 0;
                              const actual = actualHoursByLevel[level as keyof typeof actualHoursByLevel] || 0;
                              if (target === 0 && actual === 0) return null; // Hedefi ve gerçekleşeni olmayan seviyeyi gösterme

                              return (
                                <div key={level} className="flex items-center text-xs space-x-2">
                                  <span className="font-semibold w-20 text-gray-600">{level}:</span>
                                  <div className={`px-2 py-1 rounded-full inline-flex items-center gap-1 ${actual === target ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    <Clock size={12}/>
                                    {actual} / {target} saat
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-500">{getTeacherBranchesDisplay(teacher)}</div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="flex flex-wrap gap-1">{getTeacherLevelsDisplay(teacher).map((level, index) => (<span key={index} className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${level === 'Anaokulu' ? 'bg-green-100 text-green-800' : level === 'İlkokul' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>{level}</span>))}</div></td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"><div className="flex justify-end space-x-2"><Button onClick={() => handleEdit(teacher)} icon={Edit} size="sm" variant="secondary">Düzenle</Button><Button onClick={() => handleDelete(teacher.id)} icon={Trash2} size="sm" variant="danger">Sil</Button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={resetForm} title={editingTeacher ? 'Öğretmen Düzenle' : 'Yeni Öğretmen Ekle'} size="lg">
        <form onSubmit={handleSubmit}>
          <Input label="Ad Soyad" value={formData.name} onChange={(value) => setFormData({ ...formData, name: value })} placeholder="Örn: Ahmet Yılmaz" required />
          <Select label="Branş" value={formData.branch} onChange={(value) => setFormData({ ...formData, branch: value })} options={branchOptions} required />
          
          {/* YENİ: Haftalık Ders Saati Alanı */}
          <Input 
            label="Haftalık Maksimum Ders Saati" 
            type="number" 
            value={formData.totalWeeklyHours} 
            onChange={(value) => setFormData({ ...formData, totalWeeklyHours: value })} 
            placeholder="Örn: 45" 
            required 
          />
          
          <div className="mb-4"><label className="block text-sm font-semibold text-gray-800 mb-2">Eğitim Seviyeleri <span className="text-red-500">*</span></label><div className="flex flex-wrap gap-3">{EDUCATION_LEVELS.map((level) => (<label key={level} className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${formData.levels.includes(level) ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}><input type="checkbox" checked={formData.levels.includes(level)} onChange={() => handleLevelToggle(level)} className="sr-only" /><span className="text-sm font-medium">{level}</span>{formData.levels.includes(level) && (<span className="ml-2 text-blue-600">✓</span>)}</label>))}</div>{formData.levels.length > 0 && (<p className="text-xs text-blue-600 mt-2">✨ Seçilen seviyeler: {formData.levels.join(', ')}</p>)}</div>
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center"><BookOpen className="w-5 h-5 mr-2 text-indigo-600" />Dersler</h3>
            <div className="space-y-2 p-3 border border-gray-300 rounded-lg bg-gray-50 max-h-60 overflow-y-auto">
              {filteredSubjectsForModal.map((subject) => (
                <label key={subject.id} className="flex items-center space-x-3 cursor-pointer p-2 hover:bg-gray-100 rounded-md">
                  <input type="checkbox" checked={formData.subjectIds.includes(subject.id)} onChange={() => handleSubjectToggle(subject.id)} className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500" />
                  <span className="text-sm font-medium text-gray-700">{subject.name}<span className="text-xs text-gray-500 ml-2">({subject.branch} - {(subject.levels || [subject.level]).join(', ')})</span></span>
                </label>
              ))}
              {formData.levels.length > 0 && filteredSubjectsForModal.length === 0 && ( <div className="text-center text-sm text-gray-500 py-4">Seçilen seviyelere uygun ders bulunamadı.</div> )}
              {formData.levels.length === 0 && ( <div className="text-center text-sm text-gray-500 py-4">Dersleri görmek için lütfen önce eğitim seviyesi seçin.</div> )}
            </div>
            {formData.subjectIds.length > 0 && (<p className="text-xs text-indigo-600 mt-2">✨ {formData.subjectIds.length} ders seçildi.</p>)}
          </div>
          <div className="button-group-mobile mt-6"><Button type="button" onClick={resetForm} variant="secondary">İptal</Button><Button type="submit" variant="primary" disabled={!formData.branch || formData.levels.length === 0}>{editingTeacher ? 'Güncelle' : 'Kaydet'}</Button></div>
        </form>
      </Modal>

      <Modal isOpen={isBulkModalOpen} onClose={() => setIsBulkModalOpen(false)} title="Toplu Öğretmen Ekleme">
        <form onSubmit={handleBulkSubmit}>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Öğretmen Listesi</label>
              <Button type="button" onClick={addBulkRow} variant="secondary" size="sm">+ Satır Ekle</Button>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {bulkTeachers.map((teacher, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 p-3 bg-gray-50 rounded-lg">
                  <input type="text" placeholder="Ad Soyad" value={teacher.name} onChange={(e) => updateBulkRow(index, 'name', e.target.value)} className="col-span-2 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" required />
                  <select value={teacher.branch} onChange={(e) => updateBulkRow(index, 'branch', e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" required>
                    <option value="">Branş Seç</option>
                    {getUniqueBranches().map(branch => (<option key={branch} value={branch}>{branch}</option>))}
                  </select>
                  <div className="flex items-center space-x-1">
                    <select value={teacher.level} onChange={(e) => updateBulkRow(index, 'level', e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" required>
                      <option value="">Seviye</option>
                      {EDUCATION_LEVELS.map(level => (<option key={level} value={level}>{level}</option>))}
                    </select>
                    <button type="button" onClick={() => removeBulkRow(index)} className="p-1.5 bg-red-100 text-red-600 rounded hover:bg-red-200 disabled:opacity-50" disabled={bulkTeachers.length === 1}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="button-group-mobile mt-4">
            <Button type="button" onClick={() => setIsBulkModalOpen(false)} variant="secondary">İptal</Button>
            <Button type="submit" variant="primary">Toplu Ekle ({bulkTeachers.filter(t => t.name && t.branch && t.level).length} öğretmen)</Button>
          </div>
        </form>
      </Modal>

      <ConfirmationModal isOpen={confirmation.isOpen} onClose={hideConfirmation} onConfirm={confirmation.onConfirm} title={confirmation.title} message={confirmation.message} type={confirmation.type} confirmText={confirmation.confirmText} cancelText={confirmation.cancelText} confirmVariant={confirmation.confirmVariant} />
    </div>
  );
};

export default Teachers;