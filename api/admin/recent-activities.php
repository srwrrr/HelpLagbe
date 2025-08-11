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
    $activities = [];

    // Recent user registrations
    $user_stmt = $db->prepare("SELECT 'User Registration' as type, CONCAT('New user registered: ', username) as description, created_at as timestamp FROM users ORDER BY created_at DESC LIMIT 5");
    $user_stmt->execute();
    $activities = array_merge($activities, $user_stmt->fetchAll(PDO::FETCH_ASSOC));

    // Recent posts
    $post_stmt = $db->prepare("SELECT 'Service Request' as type, CONCAT('New service request: ', Category) as description, created_at as timestamp FROM posts ORDER BY created_at DESC LIMIT 5");
    $post_stmt->execute();
    $activities = array_merge($activities, $post_stmt->fetchAll(PDO::FETCH_ASSOC));

    // Recent task completions
    $task_stmt = $db->prepare("SELECT 'Task Completion' as type, CONCAT('Task completed in ', p.Category) as description, t.completed_at as timestamp FROM tasks t JOIN posts p ON t.post_id = p.post_id WHERE t.task_status = 'completed' AND t.completed_at IS NOT NULL ORDER BY t.completed_at DESC LIMIT 5");
    $task_stmt->execute();
    $activities = array_merge($activities, $task_stmt->fetchAll(PDO::FETCH_ASSOC));

    // Sort by timestamp
    usort($activities, function($a, $b) {
        return strtotime($b['timestamp']) - strtotime($a['timestamp']);
    });

    // Keep only 10
    $activities = array_slice($activities, 0, 10);

    sendResponse(true, $activities, 'Recent activities retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get recent activities error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get recent activities', 500);
}
