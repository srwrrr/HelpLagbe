<?php
// api/auth/technician-register.php
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

$required_fields = ['name', 'email', 'phone', 'national_id', 'skills'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$name = sanitizeInput($data['name']);
$email = sanitizeInput($data['email']);
$phone = sanitizeInput($data['phone']);
$national_id = sanitizeInput($data['national_id']);
$skills = sanitizeInput($data['skills']);

try {
    // Check if email already exists
    $check_query = "SELECT user_id FROM users WHERE email = :email";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':email', $email);
    $check_stmt->execute();
    
    $user_id = null;
    if ($check_stmt->rowCount() > 0) {
        $user = $check_stmt->fetch(PDO::FETCH_ASSOC);
        $user_id = $user['user_id'];
    } else {
        // Create new user account
        $password = password_hash('technician123', PASSWORD_DEFAULT); // Temporary password
        $user_query = "INSERT INTO users (username, email, password, phone_no) VALUES (:username, :email, :password, :phone)";
        $user_stmt = $db->prepare($user_query);
        
        $user_stmt->bindParam(':username', $name);
        $user_stmt->bindParam(':email', $email);
        $user_stmt->bindParam(':password', $password);
        $user_stmt->bindParam(':phone', $phone);
        
        if ($user_stmt->execute()) {
            $user_id = $db->lastInsertId();
        } else {
            sendResponse(false, null, 'Failed to create user account', 500);
        }
    }
    
    // Check if technician application already exists
    $tech_check = "SELECT technician_id FROM technician WHERE national_id = :national_id OR user_id = :user_id";
    $tech_stmt = $db->prepare($tech_check);
    $tech_stmt->bindParam(':national_id', $national_id);
    $tech_stmt->bindParam(':user_id', $user_id);
    $tech_stmt->execute();
    
    if ($tech_stmt->rowCount() > 0) {
        sendResponse(false, null, 'Technician application already exists', 409);
    }
    
    // Insert technician application
    $query = "INSERT INTO technician (national_id, Full_Name, Skill_details, user_id, status) 
              VALUES (:national_id, :full_name, :skills, :user_id, 'pending')";
    $stmt = $db->prepare($query);
    
    $stmt->bindParam(':national_id', $national_id);
    $stmt->bindParam(':full_name', $name);
    $stmt->bindParam(':skills', $skills);
    $stmt->bindParam(':user_id', $user_id);
    
    if ($stmt->execute()) {
        sendResponse(true, null, 'Technician application submitted successfully');
    } else {
        sendResponse(false, null, 'Failed to submit application', 500);
    }
} catch(PDOException $exception) {
    error_log("Technician registration error: " . $exception->getMessage());
    sendResponse(false, null, 'Application failed', 500);
}
?>