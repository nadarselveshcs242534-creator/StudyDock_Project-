var app = angular.module('studyDockApp', []);

// --- DIRECTIVE FOR FILE UPLOAD ---
app.directive('fileModel', ['$parse', function ($parse) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            var model = $parse(attrs.fileModel);
            var modelSetter = model.assign;
            element.bind('change', function(){
                var reader = new FileReader();
                reader.onload = function(e) {
                    scope.$apply(function(){ modelSetter(scope, e.target.result); });
                };
                reader.readAsDataURL(element[0].files[0]);
            });
        }
    };
}]);

// --- MAIN CONTROLLER ---
app.controller('MainController', function($scope, $http, $timeout) {
    
    const API_URL = "/api";
    $scope.currentUser = null;
    $scope.authMode = 'login';
    $scope.loginData = { role: 'admin' };
    $scope.regData = {};
    $scope.newUser = { teacher: {}, student: { selectedClasses: {} } };
    $scope.newClass = {};
    $scope.newSubject = {};
    $scope.db = { classes: [], users: [], assignments: [], attendance: [], notes: [], exams: [] };
    
    // --- MODALS (Fixed Naming!) ---
    $scope.openModal = function(id) { document.getElementById(id).style.display = 'block'; };
    $scope.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };

    // --- AUTHENTICATION ---
    $scope.setLoginRole = function(role) { $scope.loginData.role = role; };
    $scope.login = function() {
        $http.post(API_URL + '/login', $scope.loginData).then(function(res) {
            $scope.currentUser = res.data;
            if(!$scope.currentUser.classIds) $scope.currentUser.classIds = [];
            $scope.syncData();
        }, function(err) { alert('Invalid Credentials'); });
    };
    $scope.registerAdmin = function() {
        var payload = angular.copy($scope.regData);
        payload.role = 'admin';
        payload.id = Date.now();
        $http.post(API_URL + '/register', payload).then(function() {
            alert('Admin Created! Please Login.');
            $scope.authMode = 'login';
            $scope.regData = {}; 
        }, function(err) {
            alert('Registration Failed: ' + (err.data && err.data.error ? err.data.error : 'Network Error'));
        });
    };
    $scope.logout = function() { window.location.reload(); };

    // --- DATA SYNC & HELPERS ---
    $scope.syncData = function() {
        $http.get(API_URL + '/sync-data').then(function(res) {
            $scope.db = res.data;
            $scope.updateStudentDashboard();
        });
    };
    $scope.getClassDetails = function(id) { return $scope.db.classes.find(c => c.id == id) || {name: 'Unknown'}; };
    $scope.getUserName = function(id) { var u = $scope.db.users.find(u => u.id == id); return u ? u.name : 'Unknown'; };
    $scope.isEmpty = function(obj) { return !obj || Object.keys(obj).length === 0; };

    // --- ADMIN DASHBOARD ---
    $scope.createClass = function() {
        var payload = { id: Date.now(), name: $scope.newClass.name, section: $scope.newClass.section, subjects: [] };
        $http.post(API_URL + '/classes', payload).then(function() { $scope.syncData(); $scope.newClass = {}; alert('Class Created'); });
    };
    $scope.addSubject = function() {
        $http.post(API_URL + '/subjects', { classId: $scope.newSubject.classId, subject: $scope.newSubject.name }).then(function() { $scope.syncData(); $scope.newSubject={}; alert('Subject Added'); });
    };
    $scope.createUser = function(role) {
        var userData = role === 'teacher' ? $scope.newUser.teacher : $scope.newUser.student;
        var classIds = [];
        if(role === 'student' && userData.selectedClasses) {
            for(var cid in userData.selectedClasses) { if(userData.selectedClasses[cid]) classIds.push(parseInt(cid)); }
        }
        var payload = { id: Date.now(), name: userData.name, email: userData.email, password: userData.password, role: role, classIds: classIds };
        $http.post(API_URL + '/users', payload).then(function() { $scope.syncData(); alert(role + ' Created'); $scope.newUser = { teacher: {}, student: { selectedClasses: {} } }; });
    };
    $scope.openManageStudentModal = function() { $scope.manageStudentId = ""; $scope.editStudentClasses = {}; $scope.openModal('manageStudentModal'); };
    $scope.loadStudentForEdit = function() {
        var s = $scope.db.users.find(u => u.id == $scope.manageStudentId);
        $scope.editStudentClasses = {};
        if(s && s.classIds) s.classIds.forEach(cid => $scope.editStudentClasses[cid] = true);
    };
    $scope.saveStudentClasses = function() {
        var classIds = [];
        for(var cid in $scope.editStudentClasses) { if($scope.editStudentClasses[cid]) classIds.push(parseInt(cid)); }
        $http.post(API_URL + '/update-user-classes', {userId: $scope.manageStudentId, classIds: classIds}).then(function() { $scope.syncData(); alert('Classes Updated'); });
    };
    $scope.deleteStudent = function() {
        if(!confirm("Are you sure?")) return;
        $http.post(API_URL + '/delete-user', {userId: $scope.manageStudentId}).then(function() { $scope.syncData(); $scope.closeModal('manageStudentModal'); alert('User Deleted'); });
    };

    // --- TEACHER DASHBOARD ---
    
    // 1. Attendance
    $scope.attData = { students: [] };
    $scope.loadSubjectsForAttendance = function() {
        var cls = $scope.db.classes.find(c => c.id == $scope.attData.classId);
        $scope.attData.availableSubjects = cls ? cls.subjects : [];
        $scope.attData.students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.attData.classId))).map(s => ({id: s.id, name: s.name, status: 'Present'}));
    };
    $scope.submitAttendance = function() {
        var records = {};
        $scope.attData.students.forEach(s => records[s.id] = s.status);
        var payload = { date: $scope.attData.date, time: new Date().toLocaleTimeString(), classId: $scope.attData.classId, subject: $scope.attData.subject, records: records };
        $http.post(API_URL + '/attendance', payload).then(function() { $scope.syncData(); $scope.closeModal('attendanceModal'); alert('Attendance Saved'); });
    };
    
    // 2. Assignments
    $scope.assignData = {};
    $scope.loadSubjectsForAssign = function() {
        var cls = $scope.db.classes.find(c => c.id == $scope.assignData.classId);
        $scope.assignData.availableSubjects = cls ? cls.subjects : [];
    };
    $scope.postAssignment = function() {
        var payload = angular.copy($scope.assignData);
        payload.id = Date.now();
        payload.submissions = {};
        $http.post(API_URL + '/assignments', payload).then(function() { $scope.syncData(); $scope.closeModal('assignmentModal'); alert('Posted'); });
    };
    $scope.saveGrade = function(assignId, studentId, grade) {
        $http.post(API_URL + '/grade-assignment', {assignId: assignId, studentId: studentId, grade: grade}).then(function() { alert('Graded!'); $scope.syncData(); });
    };

    // 3. Materials / Notes
    $scope.noteData = {};
    $scope.loadSubjectsForNote = function() {
        var cls = $scope.db.classes.find(c => c.id == $scope.noteData.classId);
        $scope.noteData.availableSubjects = cls ? cls.subjects : [];
    };
    $scope.postNote = function() {
        var payload = angular.copy($scope.noteData);
        payload.id = Date.now();
        payload.date = new Date().toISOString().split('T')[0];
        payload.fileData = $scope.noteData.file;
        $http.post(API_URL + '/notes', payload).then(function() { $scope.syncData(); $scope.closeModal('notesModal'); alert('Material Uploaded!'); });
    };

    // 4. Exams
    $scope.examData = { questions: [] };
    $scope.loadSubjectsForExam = function() {
        var cls = $scope.db.classes.find(c => c.id == $scope.examData.classId);
        $scope.examData.availableSubjects = cls ? cls.subjects : [];
    };
    $scope.addExamQuestion = function() { $scope.examData.questions.push({text: '', options: ['','','',''], correct: 1}); };
    $scope.publishExam = function() {
        var payload = angular.copy($scope.examData);
        payload.id = Date.now();
        payload.results = {};
        $http.post(API_URL + '/exams', payload).then(function() { $scope.syncData(); $scope.closeModal('createExamModal'); alert('Exam Published'); });
    };

    // --- STUDENT DASHBOARD ---
    $scope.studentData = { assignments: [], notes: [], exams: [], attendance: [] };
    
    $scope.updateStudentDashboard = function() {
        if(!$scope.currentUser || $scope.currentUser.role !== 'student') return;
        
        $scope.studentData.assignments = $scope.db.assignments.filter(a => $scope.currentUser.classIds.includes(parseInt(a.classId))).map(a => {
            var cls = $scope.getClassDetails(a.classId);
            return {...a, className: cls.name, submission: a.submissions && a.submissions[$scope.currentUser.id]};
        });
        
        $scope.studentData.notes = $scope.db.notes.filter(n => $scope.currentUser.classIds.includes(parseInt(n.classId)));
        
        $scope.studentData.exams = $scope.db.exams.filter(e => $scope.currentUser.classIds.includes(parseInt(e.classId))).map(e => {
            let taken = e.results && e.results[$scope.currentUser.id];
            return {...e, taken: !!taken, score: taken ? taken.score : 0, total: taken ? taken.total : 0};
        });
        $scope.hasPendingExams = $scope.studentData.exams.some(e => !e.taken);
        
        $scope.studentData.attendance = [];
        $scope.db.attendance.filter(a => $scope.currentUser.classIds.includes(parseInt(a.classId))).forEach(a => {
            if(a.records && a.records[$scope.currentUser.id]) {
                $scope.studentData.attendance.push({date: a.date, subject: a.subject, status: a.records[$scope.currentUser.id]});
            }
        });
    };

    $scope.openSubmitAssignmentModal = function(a) {
        $scope.activeAssignment = a;
        $scope.submissionData = {};
        $scope.openModal('submitAssignmentModal');
    };
    $scope.submitAssignment = function() {
        var payload = {
            assignId: $scope.activeAssignment.id,
            studentId: $scope.currentUser.id,
            submission: { content: $scope.submissionData.content, fileData: $scope.submissionData.file, date: new Date().toISOString().split('T')[0] }
        };
        $http.post(API_URL + '/submit-assignment', payload).then(function() { $scope.syncData(); $scope.closeModal('submitAssignmentModal'); alert('Submitted'); });
    };
    $scope.openStudentExamModal = function() { $scope.openModal('studentExamListModal'); };
    $scope.startExam = function(e) {
        $scope.activeExam = e;
        $scope.examAnswers = [];
        $scope.openModal('takeExamModal');
        $scope.closeModal('studentExamListModal');
    };
    $scope.submitExam = function() {
        var score = 0;
        $scope.activeExam.questions.forEach((q, i) => { if (parseInt($scope.examAnswers[i]) === (q.correct - 1)) score++; });
        var payload = { examId: $scope.activeExam.id, studentId: $scope.currentUser.id, result: { score: score, total: $scope.activeExam.questions.length } };
        $http.post(API_URL + '/submit-exam', payload).then(function() { $scope.syncData(); $scope.closeModal('takeExamModal'); alert('Exam Submitted! Score: ' + score); });
    };

    // --- PROFILE ---
    $scope.saveProfilePic = function() {
        $http.post(API_URL + '/update-profile', {userId: $scope.currentUser.id, profilePic: $scope.newProfilePicFile}).then(function(){
            $scope.currentUser.profilePic = $scope.newProfilePicFile;
            $scope.closeModal('updateProfileModal');
        });
    };
    
    // --- ANALYTICS PLACEHOLDER ---
    $scope.generateAIReport = function() { alert("AI Module Triggered! Student data ready for regression."); };
});