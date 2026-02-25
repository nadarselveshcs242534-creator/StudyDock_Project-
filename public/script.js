var app = angular.module('studyDockApp', []);

// --- DIRECTIVE: FILE MODEL (For handling file inputs in AngularJS) ---
app.directive('fileModel', ['$parse', function ($parse) {
    return {
        restrict: 'A',
        link: function(scope, element, attrs) {
            var model = $parse(attrs.fileModel);
            var modelSetter = model.assign;
            
            element.bind('change', function(){
                scope.$apply(function(){
                    modelSetter(scope, element[0].files[0]);
                });
            });
            
            // Watch for null/undefined to clear input
            scope.$watch(attrs.fileModel, function(newVal){
                if(!newVal) element.val(null);
            });
        }
    };
}]);

// --- MAIN CONTROLLER ---
app.controller('MainController', function($scope, $http, $timeout, $q) {
    
    // --- STATE VARIABLES ---
    $scope.API_URL = "http://localhost:5000/api";
    $scope.currentUser = null; // Stores logged-in user object
    $scope.authMode = 'login'; // 'login' or 'register'
    $scope.loginRole = 'admin'; // Selected role tab in login
    $scope.reportTab = 'grading';
    
    // Data Store (Mirrors DB)
    $scope.db = { classes: [], users: [], assignments: [], notes: [], exams: [], attendance: [] };
    
    // Form Models
    $scope.loginData = { email: '', password: '' };
    $scope.regData = { name: '', email: '', password: '', profilePic: null };
    $scope.newClass = { name: '', section: '' };
    $scope.newSubject = { classId: '', name: '' };
    $scope.newUser = { 
        teacher: { name: '', email: '', password: '' }, 
        student: { name: '', email: '', password: '', profilePic: null, selectedClasses: {} } 
    };
    
    // Teacher Action Models
    $scope.attData = { classId: '', subject: '', date: new Date(), time: '', students: [], availableSubjects: [] };
    $scope.assignData = { classId: '', subject: '', title: '', desc: '', due: '', availableSubjects: [] };
    $scope.noteData = { classId: '', subject: '', title: '', content: '', file: null, availableSubjects: [] };
    $scope.examData = { classId: '', subject: '', title: '', showImmediate: true, questions: [], availableSubjects: [] };
    
    // Export Models
    $scope.exportConfig = { classId: '', date: new Date(), month: new Date(), subject: '', subjectMonth: '', availableSubjects: [] };
    
    // Student Action Models
    $scope.studentConfig = { filter: 'all' };
    $scope.dashboardTitle = "My Dashboard";
    
    $scope.studentData = { assignments: [], notes: [], exams: [], attendance: [] };
    $scope.activeAssignment = null;
    $scope.submissionData = { content: '', file: null };
    $scope.activeExam = null;
    $scope.examAnswers = {}; // Index -> OptionIndex

    // Chat
    $scope.chatOpen = false;
    $scope.chatMessages = [{text: "Hello! I'm EduBot. I'm here to help.", sender: 'bot'}];
    $scope.chatInput = '';

    // Management
    $scope.manageStudentId = '';
    $scope.editStudentClasses = {};
    $scope.aiSelectedClass = '';
    $scope.aiData = { studentReports: [] }; // Initialized report array

    // --- HELPER: Base64 Conversion ---
    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    // --- HELPER: Modals ---
    $scope.openModal = function(id) { document.getElementById(id).style.display = 'block'; };
    $scope.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
    $scope.alert = function(msg) { $scope.alertMessage = msg; $scope.openModal('alertModal'); };
    
    $scope.isEmpty = function(obj) {
        return !obj || Object.keys(obj).length === 0;
    }

    // --- HELPER: CSV Download ---
    const downloadCSV = (filename, csvData) => {
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', filename);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // --- INITIALIZATION ---
    $scope.init = function() {
        $scope.refreshData();
    };

    $scope.refreshData = function() {
        $http.get($scope.API_URL + '/sync-data').then(function(res) {
            $scope.db = res.data;
            if($scope.currentUser && $scope.currentUser.role === 'student') {
                $scope.updateStudentView();
            }
        }, function(err) { console.error("Sync Failed", err); });
    };

    // --- EXPORT LOGIC ---
    $scope.updateExportSubjects = function() {
        $scope.loadSubjects($scope.exportConfig.classId, 'exportConfig');
    };

    $scope.exportDailyAttendance = function(isSubjectWise) {
        if(!$scope.exportConfig.classId) return $scope.alert("Select Class First");
        if(!$scope.exportConfig.date) return $scope.alert("Select Date");
        
        var dateStr = $scope.exportConfig.date.toISOString().split('T')[0];
        var rows = [['Date', 'Student Name', 'Status', 'Subject']];
        
        // Filter attendance records
        var records = $scope.db.attendance.filter(a => 
            a.classId == $scope.exportConfig.classId && 
            a.date === dateStr &&
            (isSubjectWise ? a.subject === $scope.exportConfig.subject : true)
        );

        if(records.length === 0) return $scope.alert("No records found for this date.");

        records.forEach(rec => {
            if(rec.records) {
                for (let [uid, status] of Object.entries(rec.records)) {
                    rows.push([rec.date, $scope.getUserName(uid), status, rec.subject]);
                }
            }
        });

        var csvContent = rows.map(e => e.join(",")).join("\n");
        downloadCSV(`Daily_Attendance_${dateStr}.csv`, csvContent);
    };

    $scope.exportMonthlyAttendance = function(isSubjectWise) {
        if(!$scope.exportConfig.classId) return $scope.alert("Select Class First");
        if(!$scope.exportConfig.month) return $scope.alert("Select Month");

        // Input is YYYY-MM
        var monthStr = $scope.exportConfig.month.toISOString().slice(0, 7); 
        var rows = [['Student Name', 'Total Present', 'Total Absent', 'Percentage', 'Subject']];
        
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));
        
        students.forEach(s => {
            var myRecs = $scope.db.attendance.filter(a => 
                a.classId == $scope.exportConfig.classId &&
                a.date.startsWith(monthStr) &&
                (isSubjectWise ? a.subject === $scope.exportConfig.subjectMonth : true) &&
                a.records && a.records[s.id]
            );

            var total = myRecs.length;
            var present = myRecs.filter(a => a.records[s.id] === 'Present').length;
            var absent = total - present;
            var pct = total > 0 ? ((present/total)*100).toFixed(1) : '0.0';
            
            rows.push([s.name, present, absent, pct + '%', isSubjectWise ? $scope.exportConfig.subjectMonth : 'All']);
        });

        var csvContent = rows.map(e => e.join(",")).join("\n");
        downloadCSV(`Monthly_Attendance_${monthStr}.csv`, csvContent);
    };

    $scope.exportAssignmentReport = function() {
        if(!$scope.exportConfig.classId) return $scope.alert("Select Class First");
        var rows = [['Assignment Title', 'Due Date', 'Subject', 'Student Name', 'Submission Date', 'Grade']];

        var assigns = $scope.db.assignments.filter(a => a.classId == $scope.exportConfig.classId);
        
        assigns.forEach(a => {
            if(a.submissions) {
                for(let [uid, sub] of Object.entries(a.submissions)) {
                    rows.push([a.title, a.due, a.subject, $scope.getUserName(uid), sub.date, sub.grade || 'Not Graded']);
                }
            }
        });

        var csvContent = rows.map(e => e.join(",")).join("\n");
        downloadCSV('Assignment_Report.csv', csvContent);
    };

    $scope.exportExamReport = function() {
        if(!$scope.exportConfig.classId) return $scope.alert("Select Class First");
        var rows = [['Exam Title', 'Subject', 'Student Name', 'Score', 'Total', 'Percentage']];

        var exams = $scope.db.exams.filter(e => e.classId == $scope.exportConfig.classId);
        
        exams.forEach(e => {
            if(e.results) {
                for(let [uid, res] of Object.entries(e.results)) {
                    var pct = ((res.score/res.total)*100).toFixed(1);
                    rows.push([e.title, e.subject, $scope.getUserName(uid), res.score, res.total, pct + '%']);
                }
            }
        });

        var csvContent = rows.map(e => e.join(",")).join("\n");
        downloadCSV('Exam_Report.csv', csvContent);
    };

    $scope.exportMasterReport = function() {
        if(!$scope.exportConfig.classId) return $scope.alert("Select Class First");
        
        // Comprehensive Report
        var rows = [['Student Name', 'Overall Attendance %', 'Avg Assignment Grade', 'Avg Exam Score %']];
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.exportConfig.classId)));

        students.forEach(s => {
            // 1. Attendance
            var allAtt = $scope.db.attendance.filter(a => a.classId == $scope.exportConfig.classId && a.records && a.records[s.id]);
            var attPct = 0;
            if(allAtt.length > 0) {
                var p = allAtt.filter(a => a.records[s.id] === 'Present').length;
                attPct = ((p/allAtt.length)*100).toFixed(1);
            }

            // 2. Assignments (Assuming numeric grades for simplicity, else NaN)
            var allAssign = $scope.db.assignments.filter(a => a.classId == $scope.exportConfig.classId && a.submissions && a.submissions[s.id]);
            var assignAvg = 0;
            if(allAssign.length > 0) {
                var sum = 0;
                var count = 0;
                allAssign.forEach(a => {
                    var g = parseFloat(a.submissions[s.id].grade);
                    if(!isNaN(g)) { sum += g; count++; }
                });
                if(count > 0) assignAvg = (sum/count).toFixed(1);
            }

            // 3. Exams
            var allExams = $scope.db.exams.filter(e => e.classId == $scope.exportConfig.classId && e.results && e.results[s.id]);
            var examAvg = 0;
            if(allExams.length > 0) {
                var sum = 0;
                allExams.forEach(e => {
                    sum += (e.results[s.id].score / e.results[s.id].total) * 100;
                });
                examAvg = (sum / allExams.length).toFixed(1);
            }

            rows.push([s.name, attPct + '%', assignAvg, examAvg + '%']);
        });

        var csvContent = rows.map(e => e.join(",")).join("\n");
        downloadCSV('Master_Student_Report.csv', csvContent);
    };


    // --- AUTHENTICATION ---
    $scope.setRole = function(role) { $scope.loginRole = role; };

    $scope.registerAdmin = async function() {
        let pic = null;
        if($scope.regData.profilePic) pic = await toBase64($scope.regData.profilePic);
        
        var payload = {
            id: Date.now(),
            name: $scope.regData.name,
            email: $scope.regData.email,
            password: $scope.regData.password,
            role: 'admin',
            profilePic: pic
        };

        $http.post($scope.API_URL + '/register', payload).then(function(res) {
            $scope.alert("Admin Account Created! Please Login.");
            $scope.authMode = 'login';
            $scope.refreshData();
        }, function() { $scope.alert("Registration Failed."); });
    };

    $scope.login = function() {
        var payload = { email: $scope.loginData.email, password: $scope.loginData.password, role: $scope.loginRole };
        $http.post($scope.API_URL + '/login', payload).then(function(res) {
            $scope.currentUser = res.data;
            if(!$scope.currentUser.classIds) $scope.currentUser.classIds = $scope.currentUser.classId ? [$scope.currentUser.classId] : [];
            $scope.refreshData();
            // Reset forms
            $scope.loginData = {};
        }, function() { $scope.alert("Invalid Credentials!"); });
    };

    $scope.logout = function() {
        window.location.reload();
    };

    // --- PROFILE ---
    $scope.$watch('newProfilePicFile', function(newVal){
        if(newVal) {
            toBase64(newVal).then(function(b64){
                $timeout(function(){ $scope.previewProfileSrc = b64; });
            });
        }
    });

    $scope.saveProfilePic = async function() {
        if(!$scope.newProfilePicFile) return;
        let b64 = await toBase64($scope.newProfilePicFile);
        $http.post($scope.API_URL + '/update-profile', { userId: $scope.currentUser.id, profilePic: b64 })
        .then(function() {
            $scope.currentUser.profilePic = b64;
            $scope.closeModal('updateProfileModal');
            $scope.alert("Profile Updated!");
        });
    };

    // --- ADMIN ACTIONS ---
    $scope.createClass = function() {
        var payload = { id: Date.now(), name: $scope.newClass.name, section: $scope.newClass.section, subjects: [] };
        $http.post($scope.API_URL + '/classes', payload).then(function() {
            $scope.refreshData();
            $scope.newClass = {};
            $scope.alert("Class Created!");
        });
    };

    $scope.addSubject = function() {
        $http.post($scope.API_URL + '/subjects', { classId: $scope.newSubject.classId, subject: $scope.newSubject.name })
        .then(function() { $scope.refreshData(); $scope.newSubject.name = ''; $scope.alert("Subject Added!"); });
    };

    $scope.createUser = async function(role) {
        let payload = { id: Date.now(), role: role };
        if(role === 'teacher') {
            Object.assign(payload, $scope.newUser.teacher);
            payload.classIds = [];
        } else {
            Object.assign(payload, $scope.newUser.student);
            // Convert checkbox object to array of IDs
            payload.classIds = Object.keys($scope.newUser.student.selectedClasses)
                .filter(k => $scope.newUser.student.selectedClasses[k])
                .map(Number);
            if(payload.profilePic) payload.profilePic = await toBase64(payload.profilePic);
        }

        $http.post($scope.API_URL + '/users', payload).then(function() {
            $scope.refreshData();
            $scope.alert(role + " Created!");
            // Reset
            if(role==='teacher') $scope.newUser.teacher = {};
            else $scope.newUser.student = { selectedClasses: {} };
        }, function() { $scope.alert("Error creating user."); });
    };

    // Manage Students
    $scope.openManageStudentModal = function() {
        $scope.manageStudentId = ''; 
        $scope.openModal('manageStudentModal');
    };

    $scope.loadStudentForEdit = function() {
        var student = $scope.db.users.find(u => u.id == $scope.manageStudentId);
        $scope.editStudentClasses = {};
        if(student && student.classIds) {
            student.classIds.forEach(id => $scope.editStudentClasses[id] = true);
        }
    };

    $scope.saveStudentClasses = function() {
        var ids = Object.keys($scope.editStudentClasses).filter(k => $scope.editStudentClasses[k]).map(Number);
        $http.post($scope.API_URL + '/update-user-classes', { userId: $scope.manageStudentId, classIds: ids })
        .then(function() { $scope.refreshData(); $scope.closeModal('manageStudentModal'); $scope.alert("Updated!"); });
    };

    $scope.deleteStudent = function() {
        if(!confirm("Are you sure?")) return;
        $http.post($scope.API_URL + '/delete-user', { userId: $scope.manageStudentId })
        .then(function() { $scope.refreshData(); $scope.closeModal('manageStudentModal'); $scope.alert("Deleted!"); });
    };

    // --- TEACHER HELPER ---
    $scope.loadSubjects = function(classId, targetModel) {
        var cls = $scope.db.classes.find(c => c.id == classId);
        if(cls) $scope[targetModel].availableSubjects = cls.subjects;
        else $scope[targetModel].availableSubjects = [];
    };

    // --- ATTENDANCE ---
    $scope.loadSubjectsForAttendance = function() {
        $scope.loadSubjects($scope.attData.classId, 'attData');
        // Load Students
        $scope.attData.students = $scope.db.users
            .filter(u => u.role === 'student' && u.classIds.includes(parseInt($scope.attData.classId)))
            .map(u => ({ id: u.id, name: u.name, status: 'Present' }));
    };

    $scope.submitAttendance = function() {
        var records = {};
        $scope.attData.students.forEach(s => records[s.id] = s.status);
        var payload = {
            date: $scope.attData.date.toISOString().split('T')[0],
            time: $scope.attData.time, // simplified for demo
            classId: $scope.attData.classId,
            subject: $scope.attData.subject,
            records: records
        };
        $http.post($scope.API_URL + '/attendance', payload).then(function() {
            $scope.refreshData(); $scope.closeModal('attendanceModal'); $scope.alert("Saved!");
        });
    };

    // --- ASSIGNMENTS & NOTES ---
    $scope.loadSubjectsForAssign = function() { $scope.loadSubjects($scope.assignData.classId, 'assignData'); };
    $scope.loadSubjectsForNote = function() { $scope.loadSubjects($scope.noteData.classId, 'noteData'); };

    $scope.postAssignment = function() {
        var p = angular.copy($scope.assignData);
        p.id = Date.now();
        p.submissions = {};
        p.due = p.due.toISOString().split('T')[0];
        delete p.availableSubjects;
        
        $http.post($scope.API_URL + '/assignments', p).then(function() {
            $scope.refreshData(); $scope.closeModal('assignmentModal'); $scope.alert("Posted!");
            $scope.assignData = { availableSubjects: [] };
        });
    };

    $scope.postNote = async function() {
        if(!$scope.noteData.file) return $scope.alert("File required");
        var b64 = await toBase64($scope.noteData.file);
        var p = {
            id: Date.now(),
            classId: $scope.noteData.classId,
            subject: $scope.noteData.subject,
            title: $scope.noteData.title,
            content: $scope.noteData.content,
            fileName: $scope.noteData.file.name,
            fileData: b64,
            date: new Date().toLocaleDateString()
        };
        $http.post($scope.API_URL + '/notes', p).then(function() {
            $scope.refreshData(); $scope.closeModal('notesModal'); $scope.alert("Uploaded!");
            $scope.noteData = { availableSubjects: [] };
        });
    };

    // --- EXAMS ---
    $scope.loadSubjectsForExam = function() { $scope.loadSubjects($scope.examData.classId, 'examData'); };
    
    $scope.addExamQuestion = function() {
        $scope.examData.questions.push({ text: '', options: ['', '', '', ''], correct: 1 });
    };

    $scope.publishExam = function() {
        if($scope.examData.questions.length === 0) return $scope.alert("Add questions.");
        var p = angular.copy($scope.examData);
        p.id = Date.now();
        p.results = {};
        p.questions.forEach(q => q.correct = q.correct - 1); // fix index
        delete p.availableSubjects;
        
        $http.post($scope.API_URL + '/exams', p).then(function() {
            $scope.refreshData(); $scope.closeModal('createExamModal'); $scope.alert("Published!");
            $scope.examData = { questions: [], availableSubjects: [] };
        });
    };

    // --- TEACHER REPORTING ---
    $scope.getClassDetails = function(id) {
        return $scope.db.classes.find(c => c.id == id) || { name: 'Unknown', section: '' };
    };
    $scope.getUserName = function(id) {
        var u = $scope.db.users.find(user => user.id == id);
        return u ? u.name : 'Unknown';
    };

    $scope.saveGrade = function(assignId, studentId, grade) {
        $http.post($scope.API_URL + '/grade-assignment', { assignId, studentId, grade }).then(function() {
            $scope.refreshData(); $scope.alert("Grade Saved");
        });
    };

    $scope.generateAIReport = function() {
        var cid = $scope.aiSelectedClass;
        if(!cid) return $scope.alert("Select Class");
        
        // Simple client-side calculation logic
        var points = [];
        var students = $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt(cid)));
        
        if(students.length < 2) return $scope.alert("Not enough students data.");

        // Data gathering loop
        var studentMetrics = students.map(s => {
            // Attendance %
            var myAtt = $scope.db.attendance.filter(a => a.classId == cid && a.records && a.records[s.id]);
            var attPct = myAtt.length ? (myAtt.filter(a => a.records[s.id] === 'Present').length / myAtt.length * 100) : 0;
            
            // Exam Avg & Weakness detection
            var examSum = 0, examCount = 0;
            var weakSubjects = [];

            $scope.db.exams.filter(e => e.classId == cid && e.results && e.results[s.id]).forEach(e => {
                var score = (e.results[s.id].score / e.results[s.id].total) * 100;
                examSum += score;
                examCount++;
                // Identify weak subjects (e.g., less than 50%)
                if(score < 50) weakSubjects.push(`${e.subject}`);
            });

            var examAvg = examCount ? (examSum / examCount) : 0;
            
            return { id: s.id, name: s.name, x: attPct, y: examAvg, weakAreas: weakSubjects };
        });

        // Filter valid points for regression
        points = studentMetrics.filter(m => m.y > 0 || m.x > 0);

        // Regression
        var n = points.length;
        var sumX = points.reduce((a, b) => a + b.x, 0);
        var sumY = points.reduce((a, b) => a + b.y, 0);
        var sumXY = points.reduce((a, b) => a + (b.x * b.y), 0);
        var sumXX = points.reduce((a, b) => a + (b.x * b.x), 0);
        var slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        var intercept = (sumY - slope * sumX) / n;

        // --- NEW: GENERATE STUDENT PREDICTION REPORT ---
        $scope.aiData.studentReports = studentMetrics.map(s => {
            var predictedY = (slope * s.x) + intercept;
            if(predictedY > 100) predictedY = 100;
            if(predictedY < 0) predictedY = 0;

            // Determine Status
            var diff = s.y - predictedY; // Actual - Predicted
            var status = 'ON TRACK';
            var color = 'gray'; // Default

            if(diff > 5) { 
                status = 'OVERPERFORMING'; 
                color = 'green';
            } else if (diff < -5) {
                status = 'UNDERPERFORMING';
                color = 'red';
            }

            return {
                name: s.name,
                attendance: s.x.toFixed(1),
                actual: s.y.toFixed(1),
                predicted: predictedY.toFixed(1),
                status: status,
                color: color,
                weakAreas: s.weakAreas.join(', ')
            };
        });

        $scope.aiData.slope = slope;
        $scope.aiData.intercept = intercept;

        // Draw Chart
        $timeout(function() {
            var ctx = document.getElementById('aiChart').getContext('2d');
            if(window.aiChartInstance) window.aiChartInstance.destroy();
            
            var scatterData = points.map(p => ({ x: p.x, y: p.y }));
            var lineData = [{ x: 0, y: intercept }, { x: 100, y: (slope * 100) + intercept }];
            
            window.aiChartInstance = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [
                        { label: 'Students', data: scatterData, backgroundColor: '#9333ea' },
                        { label: 'Trend', data: lineData, type: 'line', borderColor: '#ef4444', showLine: true }
                    ]
                },
                options: { scales: { x: { min: 0, max: 100, title: {display: true, text: 'Attendance (%)'} }, y: { min: 0, max: 100, title: {display: true, text: 'Exam Score (%)'} } } }
            });
        });
    };

    // --- STUDENT VIEW (UPDATED FOR BETTER FILTERING) ---
    $scope.updateStudentView = function() {
        var filterVal = $scope.studentConfig.filter;
        var cids = [];
        
        if (filterVal === 'all') {
            cids = $scope.currentUser.classIds;
            $scope.dashboardTitle = "My Dashboard (All Classes)";
        } else {
            // Ensure strict integer comparison logic
            var selectedId = parseInt(filterVal);
            cids = [selectedId];
            
            // Differentiate UI: Update Title
            var cls = $scope.getClassDetails(selectedId);
            $scope.dashboardTitle = cls.name + (cls.section ? ' (' + cls.section + ')' : '');
        }
        
        $scope.studentData.assignments = $scope.db.assignments
            .filter(a => cids.includes(parseInt(a.classId)))
            .map(a => {
                a.className = $scope.getClassDetails(a.classId).name;
                a.submission = a.submissions ? a.submissions['' + $scope.currentUser.id] : null;
                return a;
            });

        $scope.studentData.notes = $scope.db.notes.filter(n => cids.includes(parseInt(n.classId)));
        
        $scope.studentData.attendance = [];
        $scope.db.attendance.filter(a => cids.includes(parseInt(a.classId))).forEach(a => {
            if(a.records && a.records[$scope.currentUser.id]) {
                $scope.studentData.attendance.push({
                    date: a.date, time: a.time, subject: a.subject, status: a.records[$scope.currentUser.id]
                });
            }
        });

        $scope.studentData.exams = $scope.db.exams.filter(e => cids.includes(parseInt(e.classId))).map(e => {
            var res = e.results ? e.results['' + $scope.currentUser.id] : null;
            e.taken = !!res;
            if(res) { e.score = res.score; e.total = res.total; }
            return e;
        });
        
        $scope.hasPendingExams = $scope.studentData.exams.some(e => !e.taken);
    };

    $scope.openSubmitAssignmentModal = function(assignment) {
        $scope.activeAssignment = assignment;
        $scope.submissionData = { content: '', file: null };
        $scope.openModal('submitAssignmentModal');
    };

    $scope.submitAssignment = async function() {
        var payload = {
            assignId: $scope.activeAssignment.id,
            studentId: $scope.currentUser.id,
            submission: {
                content: $scope.submissionData.content,
                date: new Date().toISOString().split('T')[0],
                grade: null
            }
        };
        if($scope.submissionData.file) {
            payload.submission.fileName = $scope.submissionData.file.name;
            payload.submission.fileData = await toBase64($scope.submissionData.file);
        }
        $http.post($scope.API_URL + '/submit-assignment', payload).then(function() {
            $scope.refreshData(); $scope.closeModal('submitAssignmentModal'); $scope.alert("Submitted!");
        });
    };

    $scope.openStudentExamModal = function() {
        $scope.updateStudentView();
        $scope.openModal('studentExamListModal');
    };

    $scope.startExam = function(exam) {
        $scope.activeExam = exam;
        $scope.examAnswers = {};
        $scope.closeModal('studentExamListModal');
        $scope.openModal('takeExamModal');
    };

    $scope.submitExam = function() {
        var score = 0;
        $scope.activeExam.questions.forEach((q, idx) => {
            if(parseInt($scope.examAnswers[idx]) === q.correct) score++;
        });
        
        var payload = {
            examId: $scope.activeExam.id,
            studentId: $scope.currentUser.id,
            result: { score: score, total: $scope.activeExam.questions.length, date: new Date().toLocaleDateString() }
        };

        $http.post($scope.API_URL + '/submit-exam', payload).then(function() {
            $scope.refreshData(); 
            $scope.closeModal('takeExamModal');
            if($scope.activeExam.showImmediate) $scope.alert("Score: " + score + "/" + $scope.activeExam.questions.length);
            else $scope.alert("Exam Submitted.");
        });
    };

    // --- CHATBOT ---
    $scope.toggleChat = function() { $scope.chatOpen = !$scope.chatOpen; };
    
    $scope.sendMessage = function() {
        if(!$scope.chatInput) return;
        var text = $scope.chatInput;
        $scope.chatMessages.push({text: text, sender: 'user'});
        $scope.chatInput = '';
        
        $scope.chatMessages.push({text: "EduBot is typing...", sender: 'bot', temp: true});
        
        $timeout(function() {
            // Remove temp message
            $scope.chatMessages = $scope.chatMessages.filter(m => !m.temp);
            
            var response = "I'm still learning!";
            if(text.includes('hello')) response = "Hi there! How can I help you today?";
            else if(text.includes('exam')) response = "Check the Exams section for pending tests.";
            else if(text.includes('assignment')) response = "You can view your homework in the Assignments tab.";
            
            $scope.chatMessages.push({text: response, sender: 'bot'});
        }, 1000);
    };

    // --- INIT ---
    $scope.init();
});