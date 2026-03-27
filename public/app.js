var app = angular.module('studyDockApp', []);

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

app.controller('MainController', function($scope, $http, $timeout) {
    
    const API_URL = "/api";
    
    $scope.currentUser = null;
    $scope.authMode = 'login';
    $scope.loginData = { role: 'admin' };
    $scope.regData = {};
    $scope.newUser = { teacher: {}, student: { selectedClasses: {} } };
    $scope.newClass = {};
    $scope.newSubject = {};
    $scope.editClassData = { subjects: [] }; // NEW: Holds data for the Edit Class Modal
    $scope.db = { classes: [], users: [], assignments: [], attendance: [], notes: [], exams: [] };
    
    $scope.openModal = function(id) { document.getElementById(id).style.display = 'block'; };
    $scope.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };

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

    // NEW: Open Edit Modal
    $scope.openEditClassModal = function(cls) {
        $scope.editClassData = angular.copy(cls);
        $scope.editClassData.newSubject = '';
        $scope.openModal('editClassModal');
    };

    // NEW: Save Class Update
    $scope.saveClassUpdate = function() {
        var payload = { classId: $scope.editClassData.id, name: $scope.editClassData.name, section: $scope.editClassData.section };
        $http.post(API_URL + '/update-class', payload).then(function() {
            $scope.syncData();
            $scope.closeModal('editClassModal');
            alert('Class Details Updated!');
        });
    };

    // NEW: Remove Subject
    $scope.removeSubject = function(subjectName) {
        if(!confirm("Remove subject '" + subjectName + "'?")) return;
        $http.post(API_URL + '/remove-subject', { classId: $scope.editClassData.id, subject: subjectName }).then(function() {
            $scope.editClassData.subjects = $scope.editClassData.subjects.filter(s => s !== subjectName);
            $scope.syncData();
        });
    };

    // NEW: Add Subject directly from Edit Modal
    $scope.addNewSubjectFromEdit = function() {
        if(!$scope.editClassData.newSubject) return;
        $http.post(API_URL + '/subjects', { classId: $scope.editClassData.id, subject: $scope.editClassData.newSubject })
        .then(function() {
            $scope.editClassData.subjects.push($scope.editClassData.newSubject);
            $scope.editClassData.newSubject = '';
            $scope.syncData();
        });
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
    
    $scope.deleteClass = function(classId, className) {
        if(!confirm("⚠️ Are you sure you want to completely delete '" + className + "'? This will also un-enroll all students from it. This cannot be undone.")) return;
        $http.post(API_URL + '/delete-class', {classId: classId}).then(function() { $scope.syncData(); alert('Class Deleted Successfully'); });
    };
    
    $scope.resetDatabase = function() { alert("Factory Reset requires backend API configuration."); };

    // --- TEACHER ACTIONS ---
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
        if (!grade) return alert("Please enter a grade before saving.");
        $http.post(API_URL + '/grade-assignment', {assignId: assignId, studentId: studentId, grade: grade}).then(function() { alert('Grade Saved Successfully!'); $scope.syncData(); });
    };

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

    // --- AI REPORTING ---
    $scope.generateAIReport = function() {
        var classId = $scope.aiSelectedClass;
        if(!classId) return alert('Select a class to generate the report.');
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt(classId)));
        var points = [];
        $scope.aiData.studentReports = []; 

        if(students.length === 0) return alert("No students found in this class.");

        students.forEach(s => {
            var myAtt = $scope.db.attendance.filter(a => a.classId == classId && a.records && a.records[s.id]);
            var presentCount = myAtt.filter(a => a.records[s.id] === 'Present').length;
            var x = myAtt.length > 0 ? (presentCount / myAtt.length) * 100 : 0;
            var myExams = $scope.db.exams.filter(e => e.classId == classId && e.results && e.results[s.id]);
            var scoreSum = 0;
            myExams.forEach(e => { scoreSum += (e.results[s.id].score / e.results[s.id].total) * 100; });
            var y = myExams.length > 0 ? (scoreSum / myExams.length) : 0;

            if(myExams.length > 0) points.push({x: x, y: y});

            var status = "Stable", color = "green", weak = "";
            if (y < 50) { status = "Critical"; color = "red"; weak = "Low exam retention."; }
            else if (x < 70) { status = "At Risk"; color = "gray"; weak = "Poor attendance is affecting potential."; }

            $scope.aiData.studentReports.push({
                name: s.name, attendance: Math.round(x), actual: Math.round(y),
                predicted: Math.round((x * 0.8) + 10), status: status, color: color, weakAreas: weak
            });
        });

        if(points.length < 2) return alert('Need at least 2 students with exam data to plot the regression chart.');

        var n = points.length;
        var sumX = points.reduce((a, b) => a + b.x, 0);
        var sumY = points.reduce((a, b) => a + b.y, 0);
        var sumXY = points.reduce((a, b) => a + (b.x * b.y), 0);
        var sumXX = points.reduce((a, b) => a + (b.x * b.x), 0);
        var slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        var intercept = (sumY - slope * sumX) / n;

        $timeout(function() {
            var canvas = document.getElementById('aiChart');
            if(!canvas) return;
            var ctx = canvas.getContext('2d');
            if(window.myAiChart) window.myAiChart.destroy();
            var scatterData = points.map(p => ({ x: p.x, y: p.y }));
            var lineData = [{ x: 0, y: intercept }, { x: 100, y: (slope * 100) + intercept }];

            window.myAiChart = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [
                        { label: 'Student Performance', data: scatterData, backgroundColor: '#9333ea', pointRadius: 6 },
                        { label: 'AI Trend Line', data: lineData, type: 'line', borderColor: '#ef4444', borderWidth: 2, pointRadius: 0 }
                    ]
                },
                options: { scales: { x: { type: 'linear', position: 'bottom', min: 0, max: 100, title: {display: true, text: 'Attendance %'} }, y: { min: 0, max: 100, title: {display: true, text: 'Exam Score %'} } } }
            });
        }, 200);
    };

    // --- CSV EXPORTS ---
    $scope.exportConfig = {};
    $scope.updateExportSubjects = function() {
        var cls = $scope.db.classes.find(c => c.id == $scope.exportConfig.classId);
        $scope.exportConfig.availableSubjects = cls ? cls.subjects : [];
    };
    
    $scope.downloadCSV = function(filename, csvData) {
        var blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement("a");
        var url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    $scope.exportDailyAttendance = function(subwise) {
        if (!$scope.exportConfig.classId || !$scope.exportConfig.date) return alert("Select a class and date!");
        var csv = "Student Name,Subject,Date,Status\n";
        var records = $scope.db.attendance.filter(a => a.classId == $scope.exportConfig.classId && a.date === $scope.exportConfig.date);
        if (subwise && $scope.exportConfig.subject) records = records.filter(a => a.subject === $scope.exportConfig.subject);
        
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        
        records.forEach(r => {
            students.forEach(s => {
                var status = r.records[s.id] || "No Data";
                csv += `"${s.name}","${r.subject}","${r.date}","${status}"\n`;
            });
        });
        $scope.downloadCSV("Daily_Attendance.csv", csv);
    };

    $scope.exportMonthlyAttendance = function(subwise) {
        if (!$scope.exportConfig.classId || !$scope.exportConfig.month) return alert("Select a class and month!");
        var csv = "Student Name,Subject,Month,Total Present,Total Absent\n";
        var records = $scope.db.attendance.filter(a => a.classId == $scope.exportConfig.classId && a.date && a.date.startsWith($scope.exportConfig.month));
        if (subwise && $scope.exportConfig.subjectMonth) records = records.filter(a => a.subject === $scope.exportConfig.subjectMonth);
        
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        
        students.forEach(s => {
            var present = 0, absent = 0;
            records.forEach(r => {
                if(r.records[s.id] === 'Present') present++;
                else if(r.records[s.id] === 'Absent') absent++;
            });
            csv += `"${s.name}","Mixed","${$scope.exportConfig.month}","${present}","${absent}"\n`;
        });
        $scope.downloadCSV("Monthly_Attendance.csv", csv);
    };

    $scope.exportAssignmentReport = function() {
        if (!$scope.exportConfig.classId) return alert("Select a class!");
        var csv = "Student Name,Assignment Title,Subject,Grade Status\n";
        var assignments = $scope.db.assignments.filter(a => a.classId == $scope.exportConfig.classId);
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        
        students.forEach(s => {
            assignments.forEach(a => {
                var sub = a.submissions && a.submissions[s.id];
                var grade = sub && sub.grade ? sub.grade : (sub ? "Ungraded" : "Missing");
                csv += `"${s.name}","${a.title}","${a.subject}","${grade}"\n`;
            });
        });
        $scope.downloadCSV("Assignments_Report.csv", csv);
    };

    $scope.exportExamReport = function() {
        if (!$scope.exportConfig.classId) return alert("Select a class!");
        var csv = "Student Name,Exam Title,Subject,Score,Total\n";
        var exams = $scope.db.exams.filter(e => e.classId == $scope.exportConfig.classId);
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        
        students.forEach(s => {
            exams.forEach(e => {
                var res = e.results && e.results[s.id];
                var score = res ? res.score : "Did not take";
                var total = res ? res.total : "-";
                csv += `"${s.name}","${e.title}","${e.subject}","${score}","${total}"\n`;
            });
        });
        $scope.downloadCSV("Exams_Report.csv", csv);
    };

    $scope.exportMasterReport = function() {
        if (!$scope.exportConfig.classId) return alert("Select a class!");
        var csv = "System ID,Student Name,Email\n";
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        students.forEach(s => {
            csv += `"${s.id}","${s.name}","${s.email}"\n`;
        });
        $scope.downloadCSV("Master_Directory.csv", csv);
    };

    // --- STUDENT DASHBOARD ---
    $scope.studentData = { assignments: [], notes: [], exams: [], attendance: [] };
    $scope.studentConfig = { filter: 'all' };
    
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
    $scope.updateStudentView = function() { $scope.updateStudentDashboard(); };

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
        $scope.examAnswers = {}; 
        $scope.openModal('takeExamModal');
        $scope.closeModal('studentExamListModal');
    };
    $scope.submitExam = function() {
        if (Object.keys($scope.examAnswers).length !== $scope.activeExam.questions.length) {
            return alert("You must answer all questions before submitting!");
        }

        var score = 0;
        $scope.activeExam.questions.forEach((q, i) => { 
            var studentAnswerIndex = parseInt($scope.examAnswers[i]);
            var correctAnswerIndex = parseInt(q.correct) - 1; 
            if (studentAnswerIndex === correctAnswerIndex) score++;
        });

        var payload = { 
            examId: $scope.activeExam.id, 
            studentId: $scope.currentUser.id, 
            result: { score: score, total: $scope.activeExam.questions.length } 
        };

        $http.post(API_URL + '/submit-exam', payload).then(function() { 
            $scope.syncData(); 
            $scope.closeModal('takeExamModal'); 
            alert('Exam Submitted Successfully! You scored: ' + score + '/' + $scope.activeExam.questions.length); 
        });
    };

    $scope.saveProfilePic = function() {
        $http.post(API_URL + '/update-profile', {userId: $scope.currentUser.id, profilePic: $scope.newProfilePicFile}).then(function(){
            $scope.currentUser.profilePic = $scope.newProfilePicFile;
            $scope.closeModal('updateProfileModal');
        });
    };
});