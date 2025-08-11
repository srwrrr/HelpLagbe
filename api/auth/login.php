<?php
// api/auth/login.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$database = new Database();
$db = $database->getConnection();

if ($db === null) {
    sendResponse(false, null, 'Database connection failed', 500);
}

$data = json_decode(file_get_contents("php://input"), true);

if (!$data) {
    sendResponse(false, null, 'Invalid JSON data', 400);
}

$required_fields = ['email', 'password'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$email = sanitizeInput($data['email']);
$password = $data['password'];

try {
    // Check if user exists
    $query = "SELECT user_id, username, email, password, phone_no, address FROM users WHERE email = :email";
    $stmt = $db->prepare($query);
    $stmt->bindParam(':email', $email);
    $stmt->execute();
    
    if ($stmt->rowCount() > 0) {
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (password_verify($password, $user['password'])) {
            // Set session
            $_SESSION['user_id'] = $user['user_id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['email'] = $user['email'];
            
            // Check if user is also a technician
            $tech_query = "SELECT technician_id, status FROM technician WHERE user_id = :user_id";
            $tech_stmt = $db->prepare($tech_query);
            $tech_stmt->bindParam(':user_id', $user['user_id']);
            $tech_stmt->execute();
            
            $is_technician = false;
            if ($tech_stmt->rowCount() > 0) {
                $tech_data = $tech_stmt->fetch(PDO::FETCH_ASSOC);
                $is_technician = $tech_data['status'] === 'approved';
            }
            
            sendResponse(true, [
                'user_id' => $user['user_id'],
                'username' => $user['username'],
                'email' => $user['email'],
                'phone' => $user['phone_no'],
                'address' => $user['address'],
                'is_technician' => $is_technician
            ], 'Login successful');
        } else {
            sendResponse(false, null, 'Invalid email or password', 401);
        }
    } else {
        sendResponse(false, null, 'Invalid email or password', 401);
    }
} catch(PDOException $exception) {
    error_log("Login error: " . $exception->getMessage());
    sendResponse(false, null, 'Login failed', 500);
}
?>