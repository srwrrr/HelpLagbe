<?php
require_once 'config.php';

session_start();

// Check if user is admin
function requireAdmin() {
    if (!isset($_SESSION['logged_in']) || $_SESSION['logged_in'] !== true || 
        !isset($_SESSION['is_admin']) || $_SESSION['is_admin'] !== true) {
        sendResponse(false, 'Admin access required');
    }
}

$conn = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'POST':
        if (isset($input['action'])) {
            switch ($input['action']) {
                case 'admin_login':
                    handleAdminLogin($conn, $input);
                    break;
                case 'approve_technician':
                    requireAdmin();
                    approveTechnician($conn, $input);
                    break;
                case 'reject_technician':
                    requireAdmin();
                    rejectTechnician($conn, $input);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    case 'GET':
        if (isset($_GET['action'])) {
            switch ($_GET['action']) {
                case 'check_admin_session':
                    checkAdminSession();
                    break;
                case 'all_users':
                    requireAdmin();
                    getAllUsers($conn);
                    break;
                case 'all_technicians':
                    requireAdmin();
                    getAllTechnicians($conn);
                    break;
                case 'all_posts':
                    requireAdmin();
                    getAllPosts($conn);
                    break;
                case 'all_tasks':
                    requireAdmin();
                    getAllTasks($conn);
                    break;
                case 'user_details':
                    requireAdmin();
                    getUserDetails($conn, $_GET['user_id']);
                    break;
                case 'user_posts':
                    requireAdmin();
                    getUserPostsAdmin($conn, $_GET['user_id']);
                    break;
                case 'dashboard_stats':
                    requireAdmin();
                    getDashboardStats($conn);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    default:
        sendResponse(false, 'Method not allowed');
}

function handleAdminLogin($conn, $data) {
    $username = sanitizeInput($data['username']);
    $password = $data['password'];
    
    // For demo purposes, hardcoded admin credentials
    // In production, store admin credentials in database with proper hashing
    $admin_username = 'admin';
    $admin_password = 'admin123';
    
    if ($username === $admin_username && $password === $admin_password) {
        $_SESSION['logged_in'] = true;
        $_SESSION['is_admin'] = true;
        $_SESSION['admin_username'] = $username;
        
        sendResponse(true, 'Admin login successful', [
            'username' => $username,
            'is_admin' => true
        ]);
    } else {
        sendResponse(false, 'Invalid admin credentials');
    }
}

function checkAdminSession() {
    if (isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true && 
        isset($_SESSION['is_admin']) && $_SESSION['is_admin'] === true) {
        sendResponse(true, 'Admin session active', [
            'username' => $_SESSION['admin_username'],
            'is_admin' => true
        ]);
    } else {
        sendResponse(false, 'No admin session');
    }
}

function getAllUsers($conn) {
    $stmt = $conn->prepare("
        SELECT u.*, 
               COUNT(p.post_id) as post_count,
               (SELECT COUNT(*) FROM technician WHERE user_id = u.user_id) as is_technician
        FROM Users u 
        LEFT JOIN Posts p ON u.user_id = p.user_id 
        GROUP BY u.user_id 
        ORDER BY u.user_id DESC
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    
    $users = [];
    while ($row = $result->fetch_assoc()) {
        // Remove password from response
        unset($row['password']);
        $users[] = $row;
    }
    
    sendResponse(true, 'Users retrieved successfully', $users);
}

function getAllTechnicians($conn) {
    $stmt = $conn->prepare("
        SELECT t.*, u.username, u.email, u.phone_no, u.address,
               COUNT(ta.task_id) as task_count,
               AVG(CASE WHEN ta.task_status = 'completed' THEN 1 ELSE 0 END) * 100 as completion_rate
        FROM technician t 
        JOIN Users u ON t.user_id = u.user_id 
        LEFT JOIN Tasks ta ON t.technician_id = ta.technician_id 
        GROUP BY t.technician_id 
        ORDER BY t.technician_id DESC
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    
    $technicians = [];
    while ($row = $result->fetch_assoc()) {
        $technicians[] = $row;
    }
    
    sendResponse(true, 'Technicians retrieved successfully', $technicians);
}

function getAllPosts($conn) {
    $stmt = $conn->prepare("
        SELECT p.*, u.username as posted_by, u.email as user_email,
               COUNT(t.task_id) as bid_count,
               MAX(CASE WHEN t.task_status = 'accepted' THEN 1 ELSE 0 END) as is_accepted
        FROM Posts p 
        JOIN Users u ON p.user_id = u.user_id 
        LEFT JOIN Tasks t ON p.post_id = t.post_id 
        GROUP BY p.post_id 
        ORDER BY p.post_id DESC
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    
    $posts = [];
    while ($row = $result->fetch_assoc()) {
        $posts[] = $row;
    }
    
    sendResponse(true, 'Posts retrieved successfully', $posts);
}

function getAllTasks($conn) {
    $stmt = $conn->prepare("
        SELECT t.*, p.Post_detail, p.Category, 
               u.username as client_name, u.email as client_email,
               tech.Full_Name as technician_name, tech_u.email as technician_email
        FROM Tasks t 
        JOIN Posts p ON t.post_id = p.post_id 
        JOIN Users u ON p.user_id = u.user_id 
        JOIN technician tech ON t.technician_id = tech.technician_id 
        JOIN Users tech_u ON tech.user_id = tech_u.user_id 
        ORDER BY t.task_id DESC
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    
    $tasks = [];
    while ($row = $result->fetch_assoc()) {
        $tasks[] = $row;
    }
    
    sendResponse(true, 'Tasks retrieved successfully', $tasks);
}

function getUserDetails($conn, $user_id) {
    $stmt = $conn->prepare("
        SELECT u.*, 
               COUNT(p.post_id) as post_count,
               (SELECT COUNT(*) FROM technician WHERE user_id = u.user_id) as is_technician,
               (SELECT Full_Name FROM technician WHERE user_id = u.user_id) as technician_name,
               (SELECT Skill_details FROM technician WHERE user_id = u.user_id) as skills
        FROM Users u 
        LEFT JOIN Posts p ON u.user_id = p.user_id 
        WHERE u.user_id = ?
        GROUP BY u.user_id
    ");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        $user = $result->fetch_assoc();
        unset($user['password']); // Remove password
        sendResponse(true, 'User details retrieved', $user);
    } else {
        sendResponse(false, 'User not found');
    }
}

function getUserPostsAdmin($conn, $user_id) {
    $stmt = $conn->prepare("
        SELECT p.*, 
               COUNT(t.task_id) as bid_count,
               MAX(t.task_status) as latest_status
        FROM Posts p 
        LEFT JOIN Tasks t ON p.post_id = t.post_id 
        WHERE p.user_id = ? 
        GROUP BY p.post_id 
        ORDER BY p.post_id DESC
    ");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $posts = [];
    while ($row = $result->fetch_assoc()) {
        $posts[] = $row;
    }
    
    sendResponse(true, 'User posts retrieved', $posts);
}

function getDashboardStats($conn) {
    // Get various statistics
    $stats = [];
    
    // Total users
    $result = $conn->query("SELECT COUNT(*) as count FROM Users");
    $stats['total_users'] = $result->fetch_assoc()['count'];
    
    // Total technicians
    $result = $conn->query("SELECT COUNT(*) as count FROM technician");
    $stats['total_technicians'] = $result->fetch_assoc()['count'];
    
    // Total posts
    $result = $conn->query("SELECT COUNT(*) as count FROM Posts");
    $stats['total_posts'] = $result->fetch_assoc()['count'];
    
    // Total tasks
    $result = $conn->query("SELECT COUNT(*) as count FROM Tasks");
    $stats['total_tasks'] = $result->fetch_assoc()['count'];
    
    // Completed tasks
    $result = $conn->query("SELECT COUNT(*) as count FROM Tasks WHERE task_status = 'completed'");
    $stats['completed_tasks'] = $result->fetch_assoc()['count'];
    
    // Pending tasks
    $result = $conn->query("SELECT COUNT(*) as count FROM Tasks WHERE task_status = 'pending'");
    $stats['pending_tasks'] = $result->fetch_assoc()['count'];
    
    sendResponse(true, 'Dashboard stats retrieved', $stats);
}

function approveTechnician($conn, $data) {
    $technician_id = (int)$data['technician_id'];
    
    // In a real application, you might have an approval status field
    // For now, we'll just send a success response
    sendResponse(true, 'Technician approved successfully');
}

function rejectTechnician($conn, $data) {
    $technician_id = (int)$data['technician_id'];
    
    // In a real application, you might delete the technician or update status
    // For now, we'll just send a success response
    sendResponse(true, 'Technician rejected successfully');
}
?>