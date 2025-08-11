<?php
session_start();
include_once '../config/database.php';
include_once '../helpers/functions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    sendResponse(false, null, 'Admin authentication required', 401);
}

$database = new Database();
$db = $database->getConnection();

try {
    $stmt = $db->prepare("SELECT p.post_id as id, u.username as customer_name, p.Category as category, p.Post_detail as description, 'N/A' as budget, COUNT(t.task_id) as bids_count, COALESCE(MAX(t.task_status), 'pending') as status, p.created_at FROM posts p JOIN users u ON p.user_id = u.user_id LEFT JOIN tasks t ON p.post_id = t.post_id GROUP BY p.post_id ORDER BY p.created_at DESC");
    $stmt->execute();

    $posts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $posts, 'Posts retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get admin posts error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get posts', 500);
}
