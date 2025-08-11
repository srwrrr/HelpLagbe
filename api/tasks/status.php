<?php
// api/tasks/{task_id}/status.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

// Extract task_id from URL
$request_uri = $_SERVER['REQUEST_URI'];
$path_parts = explode('/', $request_uri);
$task_id = $path_parts[array_search('tasks', $path_parts) + 1];

if (!is_numeric($task_id)) {
    sendResponse(false, null, 'Invalid task ID', 400);
}

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data['status'])) {
    sendResponse(false, null, 'Status is required', 400);
}

$new_status = sanitizeInput($data['status']);
$allowed_statuses = ['in_progress', 'completed', 'cancelled'];

if (!in_array($new_status, $allowed_statuses)) {
    sendResponse(false, null, 'Invalid status', 400);
}

try {
    // Check if user owns this task
    $tech_query = "SELECT technician_id FROM technician WHERE user_id = :user_id";
    $tech_stmt = $db->prepare($tech_query);
    $tech_stmt->bindParam(':user_id', $user['user_id']);
    $tech_stmt->execute();
    
    if ($tech_stmt->rowCount() === 0) {
        sendResponse(false, null, 'Unauthorized', 403);
    }
    
    $technician = $tech_stmt->fetch(PDO::FETCH_ASSOC);
    
    $check_query = "SELECT task_id FROM tasks WHERE task_id = :task_id AND technician_id = :technician_id";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':task_id', $task_id);
    $check_stmt->bindParam(':technician_id', $technician['technician_id']);
    $check_stmt->execute();
    
    if ($check_stmt->rowCount() === 0) {
        sendResponse(false, null, 'Task not found or unauthorized', 404);
    }
    
    // Update task status
    $updates = ["task_status = :status", "updated_at = CURRENT_TIMESTAMP"];
    $params = [':task_id' => $task_id, ':status' => $new_status];
    
    if ($new_status === 'completed') {
        $updates[] = "completed_at = CURRENT_TIMESTAMP";
    }
    
    $query = "UPDATE tasks SET " . implode(', ', $updates) . " WHERE task_id = :task_id";
    $stmt = $db->prepare($query);
    
    if ($stmt->execute($params)) {
        sendResponse(true, null, 'Task status updated successfully');
    } else {
        sendResponse(false, null, 'Failed to update task status', 500);
    }
    
} catch(PDOException $exception) {
    error_log("Update task status error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to update task status', 500);
}
?>