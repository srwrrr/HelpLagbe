<?php
require_once 'config.php';

// Start session for authentication
session_start();

$conn = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'POST':
        if (isset($input['action'])) {
            switch ($input['action']) {
                case 'login':
                    handleLogin($conn, $input);
                    break;
                case 'register':
                    handleRegister($conn, $input);
                    break;
                case 'technician_register':
                    handleTechnicianRegister($conn, $input);
                    break;
                case 'logout':
                    handleLogout();
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        } else {
            sendResponse(false, 'Action not specified');
        }
        break;
    case 'GET':
        if (isset($_GET['action']) && $_GET['action'] === 'check_session') {
            checkSession();
        }
        break;
    default:
        sendResponse(false, 'Method not allowed');
}

function handleLogin($conn, $data) {
    $email = sanitizeInput($data['email']);
    $password = $data['password'];
    
    if (empty($email) || empty($password)) {
        sendResponse(false, 'Email and password are required');
    }
    
    // Check user in database
    $stmt = $conn->prepare("SELECT user_id, username, email, password, phone_no, address, Image FROM Users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 1) {
        $user = $result->fetch_assoc();
        
        if (verifyPassword($password, $user['password'])) {
            // Set session
            $_SESSION['user_id'] = $user['user_id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['email'] = $user['email'];
            $_SESSION['logged_in'] = true;
            
            // Remove password from response
            unset($user['password']);
            
            // Check if user is also a technician
            $tech_stmt = $conn->prepare("SELECT technician_id FROM technician WHERE user_id = ?");
            $tech_stmt->bind_param("i", $user['user_id']);
            $tech_stmt->execute();
            $tech_result = $tech_stmt->get_result();
            $user['is_technician'] = $tech_result->num_rows > 0;
            
            sendResponse(true, 'Login successful', $user);
        } else {
            sendResponse(false, 'Invalid password');
        }
    } else {
        sendResponse(false, 'User not found');
    }
}

function handleRegister($conn, $data) {
    $username = sanitizeInput($data['username']);
    $email = sanitizeInput($data['email']);
    $phone = sanitizeInput($data['phone']);
    $password = $data['password'];
    $address = sanitizeInput($data['address']);
    
    if (empty($username) || empty($email) || empty($phone) || empty($password) || empty($address)) {
        sendResponse(false, 'All fields are required');
    }
    
    // Check if email already exists
    $stmt = $conn->prepare("SELECT user_id FROM Users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        sendResponse(false, 'Email already registered');
    }
    
    // Hash password
    $hashed_password = hashPassword($password);
    
    // Insert new user
    $stmt = $conn->prepare("INSERT INTO Users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("sssss", $username, $email, $phone, $hashed_password, $address);
    
    if ($stmt->execute()) {
        $user_id = $conn->insert_id;
        
        // Set session
        $_SESSION['user_id'] = $user_id;
        $_SESSION['username'] = $username;
        $_SESSION['email'] = $email;
        $_SESSION['logged_in'] = true;
        
        $user_data = [
            'user_id' => $user_id,
            'username' => $username,
            'email' => $email,
            'phone_no' => $phone,
            'address' => $address,
            'is_technician' => false
        ];
        
        sendResponse(true, 'Registration successful', $user_data);
    } else {
        sendResponse(false, 'Registration failed');
    }
}

function handleTechnicianRegister($conn, $data) {
    $full_name = sanitizeInput($data['fullName']);
    $national_id = sanitizeInput($data['nationalId']);
    $email = sanitizeInput($data['email']);
    $phone = sanitizeInput($data['phone']);
    $skills = sanitizeInput($data['skills']);
    
    if (empty($full_name) || empty($national_id) || empty($email) || empty($phone) || empty($skills)) {
        sendResponse(false, 'All fields are required');
    }
    
    // Check if user exists with this email
    $stmt = $conn->prepare("SELECT user_id FROM Users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $user_id = null;
    if ($result->num_rows === 0) {
        // Create new user account for technician
        $temp_username = explode('@', $email)[0];
        $temp_password = hashPassword(generateRandomString(12)); // Generate random password
        
        $stmt = $conn->prepare("INSERT INTO Users (username, email, phone_no, password) VALUES (?, ?, ?, ?)");
        $stmt->bind_param("ssss", $temp_username, $email, $phone, $temp_password);
        
        if ($stmt->execute()) {
            $user_id = $conn->insert_id;
        } else {
            sendResponse(false, 'Failed to create user account');
        }
    } else {
        $user = $result->fetch_assoc();
        $user_id = $user['user_id'];
    }
    
    // Check if technician application already exists
    $stmt = $conn->prepare("SELECT technician_id FROM technician WHERE user_id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        sendResponse(false, 'Technician application already exists');
    }
    
    // Insert technician application
    $stmt = $conn->prepare("INSERT INTO technician (national_id, Full_Name, Skill_details, user_id) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("sssi", $national_id, $full_name, $skills, $user_id);
    
    if ($stmt->execute()) {
        sendResponse(true, 'Technician application submitted successfully');
    } else {
        sendResponse(false, 'Failed to submit technician application');
    }
}

function handleLogout() {
    session_destroy();
    sendResponse(true, 'Logged out successfully');
}

function checkSession() {
    if (isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true) {
        $user_data = [
            'user_id' => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'email' => $_SESSION['email']
        ];
        sendResponse(true, 'Session active', $user_data);
    } else {
        sendResponse(false, 'No active session');
    }
}
?>