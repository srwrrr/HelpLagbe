<?php
// api/posts/user-posts.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

try {
    $query = "SELECT p.post_id, p.Post_detail as description, p.Category as category, 
                     p.`Sub-Category` as subcategory, p.created_at,
                     COUNT(t.task_id) as bids_count,
                     COALESCE(MAX(t.task_status), 'pending') as status
              FROM posts p 
              LEFT JOIN tasks t ON p.post_id = t.post_id
              WHERE p.user_id = :user_id 
              GROUP BY p.post_id
              ORDER BY p.created_at DESC";
    
    $stmt = $db->prepare($query);
    $stmt->bindParam(':user_id', $user['user_id']);
    $stmt->execute();
    
    $posts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $posts, 'Posts retrieved successfully');
    
} catch(PDOException $exception) {
    error_log("Get user posts error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get posts', 500);
}
?>