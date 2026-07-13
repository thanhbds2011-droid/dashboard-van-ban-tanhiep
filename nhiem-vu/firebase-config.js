rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function userPath() {
      return /databases/$(database)/documents/users/$(request.auth.uid);
    }

    function userExists() {
      return isSignedIn() && exists(userPath());
    }

    function currentUser() {
      return get(userPath()).data;
    }

    function isActiveUser() {
      return userExists() && currentUser().active == true;
    }

    function hasRole(roleName) {
      return isActiveUser() && currentUser().role == roleName;
    }

    function isAdmin() {
      return hasRole("ADMIN");
    }

    function isDirector() {
      return hasRole("DIRECTOR");
    }

    function isDepartmentLeader() {
      return hasRole("DEPARTMENT_LEADER");
    }

    function currentDepartmentId() {
      return currentUser().departmentId;
    }

    function taskVisibleToCurrentDepartment(taskData) {
      return taskData.get('visibleDepartmentIds', []) is list
        && currentDepartmentId() in taskData.get('visibleDepartmentIds', []);
    }

    function canReadTask(taskData) {
      return isAdmin()
        || isDirector()
        || (isDepartmentLeader() && taskVisibleToCurrentDepartment(taskData));
    }

    function taskExists(taskId) {
      return exists(/databases/$(database)/documents/tasks/$(taskId));
    }

    function taskData(taskId) {
      return get(/databases/$(database)/documents/tasks/$(taskId)).data;
    }

    function canAccessTaskById(taskId) {
      return taskExists(taskId) && canReadTask(taskData(taskId));
    }

    match /departments/{departmentId} {
      allow read: if isActiveUser();
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /users/{userId} {
      allow read: if isActiveUser();
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /tasks/{taskId} {
      allow read: if isActiveUser() && canReadTask(resource.data);

      allow create: if isAdmin()
        || (
          isDepartmentLeader()
          && request.resource.data.primaryDepartmentId == currentDepartmentId()
          && request.resource.data.ownerUserId == request.auth.uid
          && request.resource.data.createdByUserId == request.auth.uid
          && request.resource.data.active == true
          && request.resource.data.supportDepartmentIds is list
          && request.resource.data.visibleDepartmentIds is list
          && request.resource.data.primaryDepartmentId in request.resource.data.visibleDepartmentIds
          && currentDepartmentId() in request.resource.data.visibleDepartmentIds
        );

      // Ban Giám đốc chỉ xem; không được cập nhật dữ liệu.
      allow update: if isAdmin()
        || (
          isDepartmentLeader()
          && resource.data.primaryDepartmentId == currentDepartmentId()
          && resource.data.ownerUserId == request.auth.uid
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
            "title",
            "description",
            "sourceType",
            "sourceDetail",
            "assignedByUserId",
            "assignedByName",
            "assignedAt",
            "deadline",
            "deadlineDateKey",
            "priority",
            "status",
            "progress",
            "result",
            "evidenceLink",
            "completedAt",
            "updatedAt",
            "updatedByUserId",
            "updatedByName"
          ])
        );

      allow delete: if false;
    }

    match /taskLogs/{logId} {
      allow read: if isActiveUser()
        && resource.data.taskId is string
        && canAccessTaskById(resource.data.taskId);

      allow create: if isActiveUser()
        && request.resource.data.taskId is string
        && request.resource.data.performedByUserId == request.auth.uid
        && canAccessTaskById(request.resource.data.taskId);

      allow update, delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
