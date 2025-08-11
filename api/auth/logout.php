<?php
// api/auth/logout.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

session_destroy();
sendResponse(true, null, 'Logged out successfully');
?>

<?php
// api/auth/check-session.php
include_once '../config/database.php';

$user = getCurrentUser();
if ($user) {
    sendResponse(true, $user, 'Session valid');
} else {
    sendResponse(false, null, 'No active session', 401);
}
?>

<?php
// api/auth/profile.php
include_once '../config/database.php';

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Get user profile
    try {
        $query = "SELECT username, email, phone_no, address FROM users WHERE user_id = :user_id";
        $stmt = $db->prepare($query);
        $stmt->bindParam(':user_id', $user['user_id']);
        $stmt->execute();
        
        if ($stmt->rowCount() > 0) {
            $profile = $stmt->fetch(PDO::FETCH_ASSOC);
            sendResponse(true, $profile, 'Profile retrieved successfully');
        } else {
            sendResponse(false, null, 'User not found', 404);
        }
    } catch(PDOException $exception) {
        error_log("Profile get error: " . $exception->getMessage());
        sendResponse(false, null, 'Failed to get profile', 500);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    // Update user profile
    $data = json_decode(file_get_contents("php://input"), true);
    
    if (!$data) {
        sendResponse(false, null, 'Invalid JSON data', 400);
    }
    
    try {
        $updates = [];
        $params = [':user_id' => $user['user_id']];
        
        if (isset($data['name']) && !empty($data['name'])) {
            $updates[] = "username = :username";
            $params[':username'] = sanitizeInput($data['name']);
        }
        
        if (isset($data['email']) && !empty($data['email'])) {
            $updates[] = "email = :email";
            $params[':email'] = sanitizeInput($data['email']);
        }
        
        if (isset($data['phone']) && !empty($data['phone'])) {
            $updates[] = "phone_no = :phone";
            $params[':phone'] = sanitizeInput($data['phone']);
        }
        
        if (isset($data['address'])) {
            $updates[] = "address = :address";
            $params[':address'] = sanitizeInput($data['address']);
        }
        
        if (isset($data['password']) && !empty($data['password'])) {
            $updates[] = "password = :password";
            $params[':password'] = password_hash($data['password'], PASSWORD_DEFAULT);
        }
        
        if (!empty($updates)) {
            $query = "UPDATE users SET " . implode(', ', $updates) . ", updated_at = CURRENT_TIMESTAMP WHERE user_id = :user_id";
            $stmt = $db->prepare($query);
            
            if ($stmt->execute($params)) {
                sendResponse(true, null, 'Profile updated successfully');
            } else {
                sendResponse(false, null, 'Failed to update profile', 500);
            }
        } else {
            sendResponse(false, null, 'No fields to update', 400);
        }
    } catch(PDOException $exception) {
        error_log("Profile update error: " . $exception->getMessage());
        sendResponse(false, null, 'Failed to update profile', 500);
    }
} else {
    sendResponse(false, null, 'Method not allowed', 405);
}
?>