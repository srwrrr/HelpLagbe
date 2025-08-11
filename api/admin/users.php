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
    $stmt = $db->prepare("SELECT u.user_id as id, u.username as name, u.email, u.phone_no as phone, u.created_at, 'active' as status, COUNT(p.post_id) as posts_count FROM users u LEFT JOIN posts p ON u.user_id = p.user_id GROUP BY u.user_id ORDER BY u.created_at DESC");
    $stmt->execute();

    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $users, 'Users retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get admin users error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get users', 500);
}
