<?php
// api/posts/history.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

try {
    $query = "SELECT p.Category as category, p.Post_detail as description,
                     t.price, t.task_status as status, t.completed_at,
                     tech.Full_Name as technician_name, t.task_id as id
              FROM posts p
              JOIN tasks t ON p.post_id = t.post_id
              JOIN technician tech ON t.technician_id = tech.technician_id
              WHERE p.user_id = :user_id AND t.task_status IN ('completed', 'cancelled')
              ORDER BY t.completed_at DESC";

    $stmt = $db->prepare($query);
    $stmt->bindParam(':user_id', $user['user_id']);
    $stmt->execute();

    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $history, 'Service history retrieved successfully');

} catch (PDOException $exception) {
    error_log("Get history error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get service history', 500);
}
?>