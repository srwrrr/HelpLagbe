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
    $stats = [];

    $stats['total_users'] = $db->query("SELECT COUNT(*) as count FROM users")->fetch(PDO::FETCH_ASSOC)['count'];
    $stats['total_technicians'] = $db->query("SELECT COUNT(*) as count FROM technician WHERE status = 'approved'")->fetch(PDO::FETCH_ASSOC)['count'];
    $stats['total_posts'] = $db->query("SELECT COUNT(*) as count FROM posts")->fetch(PDO::FETCH_ASSOC)['count'];
    $stats['total_tasks'] = $db->query("SELECT COUNT(*) as count FROM tasks WHERE task_status = 'completed'")->fetch(PDO::FETCH_ASSOC)['count'];
    $stats['revenue'] = $db->query("SELECT COALESCE(SUM(price), 0) as revenue FROM tasks WHERE task_status = 'completed'")->fetch(PDO::FETCH_ASSOC)['revenue'];
    $stats['pending_approval'] = $db->query("SELECT COUNT(*) as count FROM technician WHERE status = 'pending'")->fetch(PDO::FETCH_ASSOC)['count'];

    sendResponse(true, $stats, 'Stats retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get admin stats error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get stats', 500);
}
