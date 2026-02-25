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
                    scope.$apply(function(){
                        modelSetter(scope, e.target.result); // Save Base64
                    });
                };
                reader.readAsDataURL(element[0].files[0]);
            });
        }
    };
}]);

// --- MAIN CONTROLLER ---
app.controller('MainController', function($scope, $http, $timeout) {
    
    // Config
    const API_URL = "http://localhost:5000/api";
    $scope.currentUser = null;
    $scope.authMode = 'login';
    $scope.loginData = { role: 'admin' };
    $scope.regData = {};
    $scope.newUser = { teacher: {}, student: { classSelection: {} } };
    $scope.newClass = {};
    $scope.newSubject = {};
    $scope.db = { classes: [], users: [], assignments: [], attendance: [], exams: [] };
    $scope.isLoading = false;
    
    // Modal & Tab Logic
    $scope.activeTab = 'dashboard';
    $scope.attData = { records: {} };
    $scope.aiData = {};
    $scope.aiReport = null;

    // --- UTILS ---
    $scope.showModal = function(id) { document.getElementById(id).style.display = 'block'; };
    $scope.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
    
    // --- AUTHENTICATION ---
    $scope.setLoginRole = function(role) { $scope.loginData.role = role; };

    $scope.login = function() {
        $scope.isLoading = true;
        $http.post(API_URL + '/login', $scope.loginData).then(function(res) {
            $scope.currentUser = res.data;
            if(!$scope.currentUser.classIds) $scope.currentUser.classIds = [];
            $scope.syncData();
        }, function(err) {
            alert('Invalid Credentials');
        }).finally(() => $scope.isLoading = false);
    };

    $scope.registerAdmin = function() {
        var payload = angular.copy($scope.regData);
        payload.role = 'admin';
        payload.id = Date.now();
        $http.post(API_URL + '/register', payload).then(function() {
            alert('Admin Created! Please Login.');
            $scope.authMode = 'login';
        });
    };

    $scope.logout = function() {
        window.location.reload();
    };

    // --- DATA SYNC ---
    $scope.syncData = function() {
        $http.get(API_URL + '/sync-data').then(function(res) {
            $scope.db = res.data;
        });
    };

    // --- ADMIN ACTIONS ---
    $scope.createClass = function() {
        var payload = { id: Date.now(), name: $scope.newClass.name, section: $scope.newClass.section, subjects: [] };
        $http.post(API_URL + '/classes', payload).then(function() {
            $scope.syncData();
            $scope.newClass = {};
            alert('Class Created');
        });
    };

    $scope.addSubject = function() {
        $http.post(API_URL + '/subjects', { classId: $scope.newSubject.classId, subject: $scope.newSubject.name })
            .then(function() { $scope.syncData(); alert('Subject Added'); });
    };

    $scope.createUser = function(role) {
        var userData = role === 'teacher' ? $scope.newUser.teacher : $scope.newUser.student;
        var classIds = [];
        
        if(role === 'student') {
            for(var cid in userData.classSelection) {
                if(userData.classSelection[cid]) classIds.push(parseInt(cid));
            }
        }

        var payload = {
            id: Date.now(),
            name: userData.name,
            email: userData.email,
            password: userData.password,
            role: role,
            classIds: classIds
        };

        $http.post(API_URL + '/users', payload).then(function() {
            $scope.syncData();
            alert(role + ' Created');
            $scope.newUser = { teacher: {}, student: { classSelection: {} } };
        });
    };

    // --- TEACHER ACTIONS ---
    $scope.availableSubjects = [];
    $scope.updateSubjects = function(classId) {
        var cls = $scope.db.classes.find(c => c.id == classId);
        $scope.availableSubjects = cls ? cls.subjects : [];
    };

    $scope.getStudentsForClass = function(classId) {
        if(!classId) return [];
        return $scope.db.users.filter(u => u.role === 'student' && u.classIds.includes(parseInt(classId)));
    };

    $scope.submitAttendance = function() {
        var payload = {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            classId: $scope.attData.classId,
            subject: $scope.attData.subject,
            records: $scope.attData.records
        };
        $http.post(API_URL + '/attendance', payload).then(function() {
            $scope.syncData();
            $scope.closeModal('attendanceModal');
            alert('Attendance Saved');
        });
    };

    // --- STUDENT DATA GETTERS ---
    $scope.getStudentAssignments = function() {
        if(!$scope.currentUser) return [];
        return $scope.db.assignments.filter(a => $scope.currentUser.classIds.includes(parseInt(a.classId)));
    };

    $scope.getStudentAttendance = function() {
        if(!$scope.currentUser) return [];
        return $scope.db.attendance.filter(a => a.records && a.records[$scope.currentUser.id]);
    };

    // --- AI & LINEAR REGRESSION LOGIC ---
    $scope.generateAIReport = function() {
        var classId = $scope.aiData.classId;
        if(!classId) return alert('Select Class');

        var students = $scope.getStudentsForClass(classId);
        var points = [];

        students.forEach(s => {
            // X: Attendance %
            var myAtt = $scope.db.attendance.filter(a => a.classId == classId && a.records && a.records[s.id]);
            var presentCount = myAtt.filter(a => a.records[s.id] === 'Present').length;
            var x = myAtt.length > 0 ? (presentCount / myAtt.length) * 100 : 0;

            // Y: Avg Exam Score %
            var myExams = $scope.db.exams.filter(e => e.classId == classId && e.results && e.results[s.id]);
            var scoreSum = 0;
            myExams.forEach(e => {
                 scoreSum += (e.results[s.id].score / e.results[s.id].total) * 100;
            });
            var y = myExams.length > 0 ? (scoreSum / myExams.length) : 0;

            if(myExams.length > 0) points.push({x: x, y: y});
        });

        if(points.length < 2) return alert('Need more student data for regression.');

        // 1. Calculate Slope (m) and Intercept (b)
        var n = points.length;
        var sumX = points.reduce((a, b) => a + b.x, 0);
        var sumY = points.reduce((a, b) => a + b.y, 0);
        var sumXY = points.reduce((a, b) => a + (b.x * b.y), 0);
        var sumXX = points.reduce((a, b) => a + (b.x * b.x), 0);

        var slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        var intercept = (sumY - slope * sumX) / n;

        // R-Squared calculation
        var avgY = sumY / n;
        var ssTot = points.reduce((a, b) => a + Math.pow(b.y - avgY, 2), 0);
        var ssRes = points.reduce((a, b) => a + Math.pow(b.y - (slope * b.x + intercept), 2), 0);
        var rSquared = 1 - (ssRes / ssTot);

        $scope.aiReport = { slope: slope, intercept: intercept, rSquared: rSquared };

        // 2. Render Chart
        $timeout(function() {
            var ctx = document.getElementById('aiChartAngular').getContext('2d');
            if(window.myAiChart) window.myAiChart.destroy();

            var scatterData = points.map(p => ({ x: p.x, y: p.y }));
            var lineData = [
                { x: 0, y: intercept },
                { x: 100, y: (slope * 100) + intercept }
            ];

            window.myAiChart = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [
                        { label: 'Students', data: scatterData, backgroundColor: '#9333ea' },
                        { label: 'Trend Line', data: lineData, type: 'line', borderColor: '#ef4444', borderWidth: 2, pointRadius: 0 }
                    ]
                },
                options: { scales: { x: { type: 'linear', position: 'bottom', min: 0, max: 100 }, y: { min: 0, max: 100 } } }
            });
        }, 100);
    };

});