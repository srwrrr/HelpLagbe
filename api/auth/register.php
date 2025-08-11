<?php
// api/auth/register.php
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

$required_fields = ['name', 'email', 'password'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$name = sanitizeInput($data['name']);
$email = sanitizeInput($data['email']);
$password = password_hash($data['password'], PASSWORD_DEFAULT);
$phone = isset($data['phone']) ? sanitizeInput($data['phone']) : null;
$address = isset($data['address']) ? sanitizeInput($data['address']) : null;

try {
    // Check if email already exists
    $check_query = "SELECT user_id FROM users WHERE email = :email";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':email', $email);
    $check_stmt->execute();
    
    if ($check_stmt->rowCount() > 0) {
        sendResponse(false, null, 'Email already exists', 409);
    }
    
    // Insert new user
    $query = "INSERT INTO users (username, email, password, phone_no, address) VALUES (:username, :email, :password, :phone, :address)";
    $stmt = $db->prepare($query);
    
    $stmt->bindParam(':username', $name);
    $stmt->bindParam(':email', $email);
    $stmt->bindParam(':password', $password);
    $stmt->bindParam(':phone', $phone);
    $stmt->bindParam(':address', $address);
    
    if ($stmt->execute()) {
        $user_id = $db->lastInsertId();
        
        // Set session
        $_SESSION['user_id'] = $user_id;
        $_SESSION['username'] = $name;
        $_SESSION['email'] = $email;
        
        sendResponse(true, [
            'user_id' => $user_id,
            'username' => $name,
            'email' => $email,
            'phone' => $phone,
            'address' => $address,
            'is_technician' => false
        ], 'Registration successful');
    } else {
        sendResponse(false, null, 'Registration failed', 500);
    }
} catch(PDOException $exception) {
    error_log("Registration error: " . $exception->getMessage());
    sendResponse(false, null, 'Registration failed', 500);
}
?>