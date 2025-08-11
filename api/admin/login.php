<?php
// api/admin/login.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$database = new Database();
$db = $database->getConnection();

$data = json_decode(file_get_contents("php://input"), true);

if (!$data) {
    sendResponse(false, null, 'Invalid JSON data', 400);
}

$required_fields = ['username', 'password'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$username = sanitizeInput($data['username']);
$password = $data['password'];

// Simple admin authentication (in production, use proper hashing)
if ($username === 'admin' && $password === 'admin123') {
    $_SESSION['admin_logged_in'] = true;
    $_SESSION['admin_username'] = $username;
    
    sendResponse(true, [
        'username' => $username,
        'role' => 'admin'
    ], 'Admin login successful');
} else {
    sendResponse(false, null, 'Invalid admin credentials', 401);
}
?>

<?php
// api/admin/stats.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

// Check admin authentication
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
?>