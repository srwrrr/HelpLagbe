<?php
header('Content-Type: application/json');
require_once 'db.php';

function respond($status, $message, $data = []) {
    echo json_encode(array_merge(['status' => $status, 'message' => $message], $data));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond('error', 'Invalid request method');
}

$role = $_POST['role'] ?? '';
$loginInput = trim($_POST['email'] ?? '');  // email or username field from form
$password = $_POST['password'] ?? '';

if (!$role || !$loginInput || !$password) {
    respond('error', 'Please fill all fields.');
}

try {
    if ($role === 'admin') {
        // Admins login with username or email? Let's allow username only here:
        $stmt = $conn->prepare("SELECT * FROM users WHERE user_type = 'admin' AND username = ?");
        $stmt->execute([$loginInput]);
    } else {
        // Customers and technicians login with email
        $stmt = $conn->prepare("SELECT * FROM users WHERE user_type = ? AND email = ?");
        $stmt->execute([$role, $loginInput]);
    }

    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        respond('error', 'User not found');
    }

    if (!password_verify($password, $user['password'])) {
        respond('error', 'Incorrect password');
    }

    // Prepare display name
    $displayName = $role === 'admin' ? $user['username'] : $user['name'];

    respond('success', 'Login successful', [
        'role' => $user['user_type'],
        'userName' => $displayName,
        'userId' => $user['id']
    ]);
} catch (PDOException $e) {
    respond('error', 'Database error: ' . $e->getMessage());
}
?>
