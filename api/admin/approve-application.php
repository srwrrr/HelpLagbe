<?php
session_start();
include_once '../config/database.php';
include_once '../helpers/functions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    sendResponse(false, null, 'Admin authentication required', 401);
}

$database = new Database();
$db = $database->getConnection();

$data = json_decode(file_get_contents("php://input"), true);
if (!$data) {
    sendResponse(false, null, 'Invalid JSON data', 400);
}

$required_fields = ['id', 'type'];
$missing_fields = validateRequired($data, $required_fields);
if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$id = (int)$data['id'];
$type = sanitizeInput($data['type']);

try {
    if ($type === 'Technician Application') {
        $stmt = $db->prepare("UPDATE technician SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE technician_id = :id");
        $stmt->bindParam(':id', $id);
        if ($stmt->execute()) {
            sendResponse(true, null, 'Technician application approved successfully');
        } else {
            sendResponse(false, null, 'Failed to approve application', 500);
        }
    } else {
        sendResponse(false, null, 'Invalid application type', 400);
    }
} catch(PDOException $exception) {
    error_log("Approve application error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to approve application', 500);
}
