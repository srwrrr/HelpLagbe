<?php
// api/posts/available-tasks.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$database = new Database();
$db = $database->getConnection();

try {
    $query = "SELECT p.post_id, p.Post_detail as description, p.Category as category,
                     p.`Sub-Category` as subcategory, p.created_at,
                     u.username as customer_name,
                     COUNT(t.task_id) as bids_count
              FROM posts p
              JOIN users u ON p.user_id = u.user_id
              LEFT JOIN tasks t ON p.post_id = t.post_id AND t.task_status = 'accepted'
              WHERE NOT EXISTS (
                  SELECT 1 FROM tasks t2 
                  WHERE t2.post_id = p.post_id AND t2.task_status = 'accepted'
              )
              GROUP BY p.post_id
              ORDER BY p.created_at DESC
              LIMIT 50";
    
    $stmt = $db->prepare($query);
    $stmt->execute();
    
    $tasks = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $tasks, 'Available tasks retrieved successfully');
    
} catch(PDOException $exception) {
    error_log("Get available tasks error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get available tasks', 500);
}
?>