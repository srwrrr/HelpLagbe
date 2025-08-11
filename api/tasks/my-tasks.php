<?php
// api/tasks/my-tasks.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

try {
    // Check if user is a technician
    $tech_query = "SELECT technician_id FROM technician WHERE user_id = :user_id AND status = 'approved'";
    $tech_stmt = $db->prepare($tech_query);
    $tech_stmt->bindParam(':user_id', $user['user_id']);
    $tech_stmt->execute();
    
    if ($tech_stmt->rowCount() === 0) {
        sendResponse(false, null, 'You must be a verified technician', 403);
    }
    
    $technician = $tech_stmt->fetch(PDO::FETCH_ASSOC);
    $technician_id = $technician['technician_id'];
    
    // Get technician's tasks
    $query = "SELECT t.task_id, t.price, t.task_status as status, t.accepted_at, t.completed_at,
                     p.Category as category, p.Post_detail as description,
                     u.username as customer_name, u.phone_no as customer_phone
              FROM tasks t
              JOIN posts p ON t.post_id = p.post_id
              JOIN users u ON p.user_id = u.user_id
              WHERE t.technician_id = :technician_id
              ORDER BY t.created_at DESC";
    
    $stmt = $db->prepare($query);
    $stmt->bindParam(':technician_id', $technician_id);
    $stmt->execute();
    
    $tasks = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $tasks, 'Tasks retrieved successfully');
    
} catch(PDOException $exception) {
    error_log("Get my tasks error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get tasks', 500);
}
?>