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
    $query = "SELECT t.technician_id as id, 'Technician Application' as type,
                     t.Full_Name as name, u.email, u.phone_no as phone,
                     t.Skill_details as skills, t.created_at
              FROM technician t
              JOIN users u ON t.user_id = u.user_id
              WHERE t.status = 'pending'
              ORDER BY t.created_at ASC";
    
    $stmt = $db->prepare($query);
    $stmt->execute();
    
    $approvals = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $approvals, 'Pending approvals retrieved successfully');
    
} catch(PDOException $exception) {
    error_log("Get pending approvals error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get pending approvals', 500);
}
