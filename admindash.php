<?php
session_start();
require 'db.php'; // Your DB connection, sets $conn

$msg = '';
$error = '';

// SIMPLIFIED Approve/Reject Handler - No complex checks
if ($_POST && isset($_POST['technician_id']) && isset($_POST['action'])) {
  $tid = (int) $_POST['technician_id'];
  $action = $_POST['action'];

  // Direct database update - no transaction, no logging
  if ($action === 'approve') {
    $sql = "UPDATE technician SET status = 'approved', updated_at = NOW() WHERE technician_id = $tid";
    if ($conn->query($sql)) {
      $msg = "Technician approved successfully!";
    } else {
      $error = "Failed to approve: " . $conn->error;
    }
  } elseif ($action === 'reject') {
    $sql = "UPDATE technician SET status = 'rejected', updated_at = NOW() WHERE technician_id = $tid";
    if ($conn->query($sql)) {
      $msg = "Technician rejected successfully!";
    } else {
      $error = "Failed to reject: " . $conn->error;
    }
  }

  // Redirect to prevent resubmission
  header("Location: " . $_SERVER['PHP_SELF'] . "?tab=approvals&msg=" . urlencode($msg ? $msg : $error));
  exit;
}

// Handle URL messages
if (isset($_GET['msg'])) {
  $msg = $_GET['msg'];
}

// Handle Delete Post POST
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_post_id'])) {
  $post_id = (int) $_POST['delete_post_id'];

  // Check if post has active tasks
  $check_stmt = $conn->prepare("SELECT COUNT(*) as count FROM tasks WHERE post_id = ? AND task_status IN ('pending', 'accepted', 'in_progress')");
  $check_stmt->bind_param("i", $post_id);
  $check_stmt->execute();
  $result = $check_stmt->get_result();
  $task_count = $result->fetch_assoc()['count'];
  $check_stmt->close();

  if ($task_count > 0) {
    $error = "Cannot delete post: Post has active tasks. Please handle tasks first.";
  } else {
    // Delete completed tasks first, then the post
    $conn->begin_transaction();
    try {
      $conn->query("DELETE FROM tasks WHERE post_id = $post_id");
      $conn->query("DELETE FROM posts WHERE post_id = $post_id");
      $conn->commit();
      $msg = "Post and associated tasks deleted successfully.";
    } catch (Exception $e) {
      $conn->rollback();
      $error = "Failed to delete post: " . $e->getMessage();
    }
  }
}

// Handle Update Task Status POST
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['task_id'], $_POST['new_status'])) {
  $task_id = (int) $_POST['task_id'];
  $new_status = $_POST['new_status'];

  $allowed_statuses = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'];
  if (in_array($new_status, $allowed_statuses)) {
    $update_field = '';
    if ($new_status === 'accepted') {
      $update_field = ', accepted_at = NOW()';
    } elseif ($new_status === 'completed') {
      $update_field = ', completed_at = NOW()';
    }

    $stmt = $conn->prepare("UPDATE tasks SET task_status = ?, updated_at = NOW() $update_field WHERE task_id = ?");
    if ($stmt) {
      $stmt->bind_param("si", $new_status, $task_id);
      if ($stmt->execute()) {
        $msg = "Task status updated to $new_status successfully.";
      } else {
        $error = "Failed to update task status: " . $stmt->error;
      }
      $stmt->close();
    }
  }
}

// Handle Delete User POST - Final Working Version
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_user_id'])) {
  $user_id = (int) $_POST['delete_user_id'];

  $conn->begin_transaction();
  try {
    // 1. Delete related posts first (if any)
    $delete_posts_stmt = $conn->prepare("DELETE FROM posts WHERE user_id = ?");
    $delete_posts_stmt->bind_param("i", $user_id);
    $delete_posts_stmt->execute();
    $delete_posts_stmt->close();

    // 2. Delete technician record if exists (optional)
    $delete_tech_stmt = $conn->prepare("DELETE FROM technician WHERE user_id = ?");
    $delete_tech_stmt->bind_param("i", $user_id);
    $delete_tech_stmt->execute();
    $delete_tech_stmt->close();

    // 3. Finally, delete the user
    $delete_user_stmt = $conn->prepare("DELETE FROM users WHERE user_id = ?");
    $delete_user_stmt->bind_param("i", $user_id);
    $delete_user_stmt->execute();
    $delete_user_stmt->close();

    $conn->commit();
    $msg = "User deleted successfully.";
  } catch (Exception $e) {
    $conn->rollback();
    $error = "Failed to delete user: " . $e->getMessage();
  }
}



// Pagination & tab handling
$perPage = 10;
$page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
$offset = ($page - 1) * $perPage;

$allowed_tabs = ['overview', 'users', 'technicians', 'requests', 'tasks', 'approvals', 'reports'];
$tab = isset($_GET['tab']) && in_array($_GET['tab'], $allowed_tabs) ? $_GET['tab'] : 'overview';

function getCount($conn, $sql)
{
  $res = $conn->query($sql);
  if ($res && $row = $res->fetch_assoc()) {
    return (int) $row['count'];
  }
  return 0;
}

function getTotalPages($conn, $countSql, $perPage)
{
  $totalItems = getCount($conn, $countSql);
  return ceil($totalItems / $perPage);
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HelpLagbe - Admin Dashboard</title>
  <style>
    /* ===== Global Styles ===== */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1b1b1b 0%, #0f0f0f 100%);
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
    }

    /* Subtle animated background */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: -1;
      background:
        radial-gradient(circle at 20% 30%, rgba(255, 107, 53, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 80% 60%, rgba(255, 107, 53, 0.06) 0%, transparent 40%),
        radial-gradient(circle at 40% 80%, rgba(255, 107, 53, 0.04) 0%, transparent 40%);
      animation: subtleFloat 20s ease-in-out infinite;
    }

    @keyframes subtleFloat {

      0%,
      100% {
        transform: translateY(0px);
        opacity: 0.8;
      }

      50% {
        transform: translateY(-15px);
        opacity: 1;
      }
    }

    a {
      text-decoration: none;
      color: white;
      transition: all 0.3s ease;
    }

    a:hover {
      color: #ff6b35;
    }

    img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
    }

    /* ===== Header ===== */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(17, 17, 17, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 107, 53, 0.1);
      border-bottom: 4px solid #ff6b35;
      padding: 15px 30px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .logo {
      display: flex;
      align-items: center;
    }

    .logo img {
      height: 80px;
      transition: transform 0.3s ease;
    }

    .logo img:hover {
      transform: scale(1.05);
    }

    nav {
      display: flex;
      gap: 20px;
    }

    nav a {
      font-weight: 600;
      font-size: 1rem;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
      border-bottom: 3px solid transparent;
    }

    nav a:hover {
      color: #ff6b35;
      background: rgba(255, 107, 53, 0.1);
      transform: translateY(-2px);
    }

    nav a.active {
      color: #ff6b35;
      border-bottom: 3px solid #ff6b35;
      background: rgba(255, 107, 53, 0.1);
    }

    /* ===== Container ===== */
    .container {
      background: rgba(17, 17, 17, 0.85);
      backdrop-filter: blur(25px);
      -webkit-backdrop-filter: blur(25px);
      border: 1px solid rgba(255, 107, 53, 0.2);
      border-radius: 20px;
      padding: 40px 50px 50px;
      width: 1200px;
      margin: 60px auto 40px;
      box-shadow:
        0 0 30px rgba(255, 107, 53, 0.3),
        0 25px 50px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 255, 255, 0.1);
      min-height: 650px;
      display: flex;
      flex-direction: column;
      position: relative;
      animation: slideInUp 0.8s ease;
    }

    @keyframes slideInUp {
      0% {
        opacity: 0;
        transform: translateY(30px);
      }

      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(255, 107, 53, 0.6), transparent);
      border-radius: 20px 20px 0 0;
    }

    /* Admin Access text */
    .admin-access {
      font-weight: 700;
      font-size: 1.4rem;
      color: #ff6b35;
      margin-bottom: 30px;
      user-select: none;
      text-shadow: 0 0 15px rgba(255, 107, 53, 0.4);
      position: relative;
    }

    .admin-access::after {
      content: '';
      position: absolute;
      bottom: -8px;
      left: 0;
      width: 80px;
      height: 2px;
      background: linear-gradient(90deg, #ff6b35, transparent);
    }

    /* Buttons box */
    .buttons-box {
      background: rgba(34, 34, 34, 0.8);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      border: 1px solid rgba(255, 107, 53, 0.1);
      border-radius: 15px;
      padding: 20px;
      margin-bottom: 30px;
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    .btn {
      background: linear-gradient(135deg, #ff6b35, #e05a2e);
      border: 1px solid rgba(255, 107, 53, 0.3);
      padding: 12px 24px;
      color: white;
      cursor: pointer;
      font-weight: 700;
      border-radius: 10px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
      user-select: none;
      flex-grow: 1;
      text-align: center;
      min-width: 120px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(255, 107, 53, 0.3);
    }

    .btn:hover {
      background: linear-gradient(135deg, #e05a2e, #d14d26);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(255, 107, 53, 0.4);
    }

    .btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      transition: left 0.5s;
    }

    .btn:hover::before {
      left: 100%;
    }

    /* Stats Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 25px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: rgba(34, 34, 34, 0.8);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      border: 1px solid rgba(255, 107, 53, 0.2);
      padding: 25px;
      border-radius: 15px;
      text-align: center;
      box-shadow:
        0 8px 25px rgba(0, 0, 0, 0.3),
        0 0 15px rgba(255, 107, 53, 0.2);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #ff6b35, #ffb347);
    }

    .stat-card:hover {
      transform: translateY(-3px);
      box-shadow:
        0 12px 35px rgba(0, 0, 0, 0.4),
        0 0 25px rgba(255, 107, 53, 0.3);
    }

    .stat-card h3 {
      color: #ff6b35;
      margin-bottom: 10px;
      font-size: 1.1rem;
    }

    .stat-card p {
      font-size: 2rem;
      font-weight: 700;
      color: white;
      text-shadow: 0 0 10px rgba(255, 107, 53, 0.3);
    }

    /* Table */
    .table-container {
      background: rgba(34, 34, 34, 0.8);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      border: 1px solid rgba(255, 107, 53, 0.2);
      border-radius: 15px;
      overflow: hidden;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
      background: transparent;
    }

    th,
    td {
      padding: 15px;
      border-bottom: 1px solid rgba(255, 107, 53, 0.1);
      color: #ddd;
      text-align: left;
    }

    th {
      background: linear-gradient(135deg, #ff6b35, #e05a2e);
      color: white;
      font-weight: 700;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    tr:hover td {
      background: rgba(255, 107, 53, 0.05);
      color: white;
    }

    tr:last-child td {
      border-bottom: none;
    }

    /* Message */
    .message {
      background: rgba(42, 127, 42, 0.8);
      backdrop-filter: blur(15px);
      border: 1px solid rgba(42, 127, 42, 0.3);
      padding: 16px 20px;
      margin-bottom: 25px;
      border-radius: 15px;
      color: #d4ffd4;
      font-weight: 700;
      box-shadow: 0 8px 25px rgba(42, 127, 42, 0.3);
      text-align: center;
      user-select: none;
      animation: messageSlide 0.5s ease;
    }

    .error {
      background: rgba(220, 53, 69, 0.8);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #f8d7da;
      box-shadow: 0 8px 25px rgba(220, 53, 69, 0.3);
    }

    @keyframes messageSlide {
      0% {
        transform: translateY(-10px);
        opacity: 0;
      }

      100% {
        transform: translateY(0);
        opacity: 1;
      }
    }

    /* No data message */
    .no-data {
      text-align: center;
      padding: 40px;
      background: rgba(34, 34, 34, 0.8);
      backdrop-filter: blur(15px);
      border-radius: 15px;
      border: 1px solid rgba(255, 107, 53, 0.2);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    .no-data p {
      font-size: 1.2rem;
      color: #ff6b35;
      text-shadow: 0 0 10px rgba(255, 107, 53, 0.3);
    }

    /* Pagination */
    .pagination {
      margin-top: 25px;
      text-align: center;
      user-select: none;
    }

    .pagination a {
      color: white;
      margin: 0 8px;
      font-weight: 600;
      text-decoration: none;
      font-size: 1rem;
      padding: 10px 16px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
      display: inline-block;
    }

    .pagination a.active,
    .pagination a:hover {
      color: white;
      background: linear-gradient(135deg, #ff6b35, #e05a2e);
      box-shadow: 0 4px 15px rgba(255, 107, 53, 0.4);
      transform: translateY(-2px);
      text-decoration: none;
    }

    /* Action buttons in tables */
    .action-btn {
      padding: 6px 12px;
      font-weight: 600;
      font-size: 0.85rem;
      margin-right: 8px;
      margin-bottom: 4px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    }

    .approve-btn {
      background: linear-gradient(135deg, #ff6b35, #e05a2e);
      color: white;
      box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
    }

    .approve-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(255, 107, 53, 0.4);
    }

    .reject-btn,
    .delete-btn {
      background: rgba(220, 53, 69, 0.8);
      color: white;
      border: 1px solid rgba(220, 53, 69, 0.3);
      box-shadow: 0 2px 8px rgba(220, 53, 69, 0.3);
    }

    .reject-btn:hover,
    .delete-btn:hover {
      background: rgba(200, 35, 51, 0.9);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(220, 53, 69, 0.4);
    }

    .status-btn {
      background: rgba(40, 167, 69, 0.8);
      color: white;
      border: 1px solid rgba(40, 167, 69, 0.3);
      box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
    }

    .status-btn:hover {
      background: rgba(34, 143, 59, 0.9);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(40, 167, 69, 0.4);
    }

    /* Status badges */
    .status-badge {
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-pending {
      background: rgba(255, 193, 7, 0.2);
      color: #ffc107;
      border: 1px solid rgba(255, 193, 7, 0.4);
    }

    .status-approved,
    .status-completed {
      background: rgba(40, 167, 69, 0.2);
      color: #28a745;
      border: 1px solid rgba(40, 167, 69, 0.4);
    }

    .status-rejected,
    .status-cancelled {
      background: rgba(220, 53, 69, 0.2);
      color: #dc3545;
      border: 1px solid rgba(220, 53, 69, 0.4);
    }

    .status-in_progress,
    .status-accepted {
      background: rgba(23, 162, 184, 0.2);
      color: #17a2b8;
      border: 1px solid rgba(23, 162, 184, 0.4);
    }

    /* Select dropdown */
    select {
      background: rgba(34, 34, 34, 0.8);
      color: white;
      border: 1px solid rgba(255, 107, 53, 0.3);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-right: 8px;
    }

    select:focus {
      outline: none;
      border-color: #ff6b35;
      box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.2);
    }

    /* ===== Footer ===== */
    footer {
      background: rgba(17, 17, 17, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 107, 53, 0.1);
      border-top: 4px solid #ff6b35;
      padding: 40px 10%;
      color: white;
      box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.3);
      margin-top: auto;
    }

    .footer-top {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 30px;
      text-align: left;
      margin-bottom: 20px;
    }

    footer h3 {
      color: #ff6b35;
      margin-bottom: 15px;
      text-shadow: 0 0 10px rgba(255, 107, 53, 0.3);
    }

    footer p {
      line-height: 1.6;
      font-size: 0.95rem;
      color: #ddd;
      margin: 5px 0;
    }

    footer ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    footer ul li {
      margin: 8px 0;
      color: white;
      font-size: 0.95rem;
      transition: all 0.3s ease;
    }

    footer ul li:hover {
      color: #ff6b35;
      transform: translateX(3px);
    }

    footer ul li a {
      color: white;
      font-size: 0.95rem;
      transition: all 0.3s ease;
    }

    footer ul li a:hover {
      color: #ff6b35;
    }

    footer hr {
      border: none;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 107, 53, 0.5), transparent);
      margin: 20px 0;
    }

    .footer-bottom {
      text-align: center;
      padding-top: 10px;
      font-size: 0.9rem;
      color: #aaa;
    }

    .footer-bottom a {
      color: #aaa;
      transition: color 0.3s ease;
    }

    .footer-bottom a:hover {
      color: #ff6b35;
    }

    /* Form elements */
    .inline-form {
      display: inline-block;
      margin-right: 8px;
    }

    /* Quick stats for reports */
    .quick-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }

    .quick-stat {
      background: rgba(34, 34, 34, 0.6);
      padding: 15px;
      border-radius: 10px;
      text-align: center;
      border: 1px solid rgba(255, 107, 53, 0.2);
    }

    .quick-stat h4 {
      color: #ff6b35;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }

    .quick-stat p {
      font-size: 1.5rem;
      font-weight: 700;
      color: white;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .container {
        width: 90vw;
        min-height: auto;
        padding: 30px 20px 40px;
      }

      header {
        flex-wrap: wrap;
        gap: 10px;
        padding: 15px 20px;
      }

      nav {
        justify-content: center;
        width: 100%;
        flex-wrap: wrap;
      }

      .buttons-box {
        flex-direction: column;
        gap: 15px;
      }

      .stats-grid {
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 15px;
      }

      table {
        font-size: 0.85rem;
      }

      th,
      td {
        padding: 10px 8px;
      }

      .action-btn {
        padding: 4px 8px;
        font-size: 0.8rem;
        margin: 2px;
      }
    }

    @media (max-width: 480px) {
      .container {
        padding: 20px 15px 30px;
      }

      .admin-access {
        font-size: 1.2rem;
      }

      .stat-card {
        padding: 15px;
      }

      .stat-card p {
        font-size: 1.5rem;
      }
    }
  </style>
</head>

<body>

  <header>
    <div class="logo">
      <img src="logo.png" alt="HelpLagbe Logo" />
    </div>
    <nav>
      <a href="homepage.html">Home</a>
      <a href="#services">Services</a>
      <a href="#about">About</a>
    </nav>
    <div style="display:flex; gap:10px;">
      <button class="btn" onclick="location.href='login.html'">Logout</button>
      <button class="btn"
        onclick="document.getElementById('contact').scrollIntoView({behavior:'smooth'})">Contact</button>
    </div>
  </header>

  <div class="container">

    <div class="admin-access">Admin Access</div>

    <?php if (!empty($msg)): ?>
      <div class="message"><?php echo htmlspecialchars($msg); ?></div>
    <?php endif; ?>

    <?php if (!empty($error)): ?>
      <div class="message error"><?php echo htmlspecialchars($error); ?></div>
    <?php endif; ?>

    <div class="buttons-box">
      <a href="?tab=overview" class="btn"
        style="background: <?= $tab === 'overview' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Overview</a>
      <a href="?tab=users" class="btn"
        style="background: <?= $tab === 'users' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Users</a>
      <a href="?tab=technicians" class="btn"
        style="background: <?= $tab === 'technicians' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Technicians</a>
      <a href="?tab=requests" class="btn"
        style="background: <?= $tab === 'requests' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Service
        Requests</a>
      <a href="?tab=tasks" class="btn"
        style="background: <?= $tab === 'tasks' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Tasks</a>
      <a href="?tab=approvals" class="btn"
        style="background: <?= $tab === 'approvals' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Approvals</a>
      <a href="?tab=reports" class="btn"
        style="background: <?= $tab === 'reports' ? 'linear-gradient(135deg, #e05a2e, #d14d26)' : 'linear-gradient(135deg, #ff6b35, #e05a2e)' ?>;">Reports</a>
    </div>

    <?php if ($tab === 'overview'):
      // Fetch stats
      $totalUsers = getCount($conn, "SELECT COUNT(*) AS count FROM users");
      $totalTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician");
      $pendingTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician WHERE status = 'pending'");
      $approvedTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician WHERE status = 'approved'");
      $totalTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks");
      $completedTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks WHERE task_status = 'completed'");
      $totalRequests = getCount($conn, "SELECT COUNT(*) AS count FROM posts");
      $totalPayments = getCount($conn, "SELECT COUNT(*) AS count FROM payment");
      ?>
      <div class="stats-grid">
        <div class="stat-card">
          <h3>Total Users</h3>
          <p><?= $totalUsers ?></p>
        </div>
        <div class="stat-card">
          <h3>Total Technicians</h3>
          <p><?= $totalTechnicians ?></p>
        </div>
        <div class="stat-card">
          <h3>Pending Approvals</h3>
          <p><?= $pendingTechnicians ?></p>
        </div>
        <div class="stat-card">
          <h3>Approved Technicians</h3>
          <p><?= $approvedTechnicians ?></p>
        </div>
        <div class="stat-card">
          <h3>Total Tasks</h3>
          <p><?= $totalTasks ?></p>
        </div>
        <div class="stat-card">
          <h3>Completed Tasks</h3>
          <p><?= $completedTasks ?></p>
        </div>
        <div class="stat-card">
          <h3>Total Requests</h3>
          <p><?= $totalRequests ?></p>
        </div>
        <div class="stat-card">
          <h3>Total Payments</h3>
          <p><?= $totalPayments ?></p>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="table-container">
        <h3 style="padding: 20px; margin: 0; color: #ff6b35; border-bottom: 1px solid rgba(255, 107, 53, 0.2);">Recent
          Activity</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Details</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <?php
            // Get recent activities
            $recent_query = "
              (SELECT 'New User' as type, CONCAT('User: ', username) as details, created_at as date, 'active' as status FROM users ORDER BY created_at DESC LIMIT 3)
              UNION ALL
              (SELECT 'New Technician' as type, CONCAT('Technician: ', Full_Name) as details, created_at as date, status FROM technician ORDER BY created_at DESC LIMIT 3)
              UNION ALL
              (SELECT 'New Task' as type, CONCAT('Task ID: ', task_id) as details, created_at as date, task_status as status FROM tasks ORDER BY created_at DESC LIMIT 3)
              ORDER BY date DESC LIMIT 10
            ";
            $recent_result = $conn->query($recent_query);
            while ($row = $recent_result->fetch_assoc()): ?>
              <tr>
                <td><?= htmlspecialchars($row['type']) ?></td>
                <td><?= htmlspecialchars($row['details']) ?></td>
                <td><?= date('M j, Y H:i', strtotime($row['date'])) ?></td>
                <td><span class="status-badge status-<?= $row['status'] ?>"><?= ucfirst($row['status']) ?></span></td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>

    <?php elseif ($tab === 'users'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM users", $perPage);
      $result = $conn->query("SELECT u.user_id, u.username, u.email, u.phone_no, u.created_at, 
                              COUNT(p.post_id) as post_count 
                              FROM users u 
                              LEFT JOIN posts p ON u.user_id = p.user_id 
                              GROUP BY u.user_id 
                              ORDER BY u.created_at DESC 
                              LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Posts</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['user_id'] ?></td>
                <td><?= htmlspecialchars($row['username']) ?></td>
                <td><?= htmlspecialchars($row['email']) ?></td>
                <td><?= htmlspecialchars($row['phone_no']) ?></td>
                <td><?= $row['post_count'] ?></td>
                <td><?= date('M j, Y', strtotime($row['created_at'])) ?></td>
                <td>
                  <form method="POST" class="inline-form">
                    <input type="hidden" name="delete_user_id" value="<?= $row['user_id'] ?>" />
                    <button type="submit" class="action-btn delete-btn"
                      onclick="return confirm('Are you sure you want to delete this user? This action cannot be undone.');">Delete</button>
                  </form>
                </td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=users&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'technicians'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM technician WHERE status != 'pending'", $perPage);
      $result = $conn->query("SELECT t.technician_id, t.Full_Name, t.national_id, t.status, t.created_at, t.Skill_details,
                              COUNT(ta.task_id) as task_count,
                              AVG(tf.technician_rating) as avg_rating
                              FROM technician t 
                              LEFT JOIN tasks ta ON t.technician_id = ta.technician_id 
                              LEFT JOIN task_feedback tf ON ta.task_id = tf.task_id
                              WHERE t.status != 'pending' 
                              GROUP BY t.technician_id 
                              ORDER BY t.created_at DESC 
                              LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>National ID</th>
              <th>Skills</th>
              <th>Status</th>
              <th>Tasks</th>
              <th>Rating</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['technician_id'] ?></td>
                <td><?= htmlspecialchars($row['Full_Name']) ?></td>
                <td><?= htmlspecialchars($row['national_id']) ?></td>
                <td title="<?= htmlspecialchars($row['Skill_details']) ?>">
                  <?= htmlspecialchars(substr($row['Skill_details'], 0, 30)) ?>...
                </td>
                <td><span class="status-badge status-<?= $row['status'] ?>"><?= ucfirst($row['status']) ?></span></td>
                <td><?= $row['task_count'] ?></td>
                <td><?= $row['avg_rating'] ? number_format($row['avg_rating'], 1) . '/5' : 'N/A' ?></td>
                <td><?= date('M j, Y', strtotime($row['created_at'])) ?></td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=technicians&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'requests'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM posts", $perPage);
      $result = $conn->query("SELECT p.post_id, p.Post_detail, p.Category, p.`Sub-Category`, p.user_id, p.created_at,
                              u.username,
                              COUNT(t.task_id) as task_count
                              FROM posts p 
                              LEFT JOIN users u ON p.user_id = u.user_id 
                              LEFT JOIN tasks t ON p.post_id = t.post_id
                              GROUP BY p.post_id 
                              ORDER BY p.created_at DESC 
                              LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Detail</th>
              <th>Category</th>
              <th>Sub-Category</th>
              <th>User</th>
              <th>Tasks</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['post_id'] ?></td>
                <td title="<?= htmlspecialchars($row['Post_detail']) ?>">
                  <?= htmlspecialchars(substr($row['Post_detail'], 0, 50)) ?>...
                </td>
                <td><?= htmlspecialchars($row['Category']) ?></td>
                <td><?= htmlspecialchars($row['Sub-Category']) ?></td>
                <td><?= htmlspecialchars($row['username']) ?></td>
                <td><?= $row['task_count'] ?></td>
                <td><?= date('M j, Y', strtotime($row['created_at'])) ?></td>
                <td>
                  <form method="POST" class="inline-form">
                    <input type="hidden" name="delete_post_id" value="<?= $row['post_id'] ?>" />
                    <button type="submit" class="action-btn delete-btn"
                      onclick="return confirm('Are you sure you want to delete this post and all associated tasks?');">Delete</button>
                  </form>
                </td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=requests&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'tasks'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM tasks", $perPage);
      $result = $conn->query("SELECT t.task_id, t.task_status, t.price, t.post_id, t.technician_id, t.created_at,
                              tech.Full_Name as technician_name,
                              u.username as user_name,
                              p.Category
                              FROM tasks t 
                              LEFT JOIN technician tech ON t.technician_id = tech.technician_id 
                              LEFT JOIN posts p ON t.post_id = p.post_id
                              LEFT JOIN users u ON p.user_id = u.user_id
                              ORDER BY t.created_at DESC 
                              LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Price</th>
              <th>Category</th>
              <th>Technician</th>
              <th>User</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['task_id'] ?></td>
                <td><span
                    class="status-badge status-<?= $row['task_status'] ?>"><?= ucfirst(str_replace('_', ' ', $row['task_status'])) ?></span>
                </td>
                <td>৳<?= number_format($row['price'], 2) ?></td>
                <td><?= htmlspecialchars($row['Category']) ?></td>
                <td><?= htmlspecialchars($row['technician_name']) ?></td>
                <td><?= htmlspecialchars($row['user_name']) ?></td>
                <td><?= date('M j, Y', strtotime($row['created_at'])) ?></td>
                <td>
                  <form method="POST" class="inline-form">
                    <input type="hidden" name="task_id" value="<?= $row['task_id'] ?>" />
                    <select name="new_status">
                      <option value="">Change Status</option>
                      <option value="pending" <?= $row['task_status'] == 'pending' ? 'selected' : '' ?>>Pending</option>
                      <option value="accepted" <?= $row['task_status'] == 'accepted' ? 'selected' : '' ?>>Accepted</option>
                      <option value="in_progress" <?= $row['task_status'] == 'in_progress' ? 'selected' : '' ?>>In Progress
                      </option>
                      <option value="completed" <?= $row['task_status'] == 'completed' ? 'selected' : '' ?>>Completed</option>
                      <option value="cancelled" <?= $row['task_status'] == 'cancelled' ? 'selected' : '' ?>>Cancelled</option>
                    </select>
                    <button type="submit" class="action-btn status-btn">Update</button>
                  </form>
                </td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=tasks&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'approvals'):
      // Simple query for pending technicians
      $result = $conn->query("
        SELECT t.technician_id, t.Full_Name, t.national_id, t.created_at, t.Skill_details,
               u.email, u.phone_no
        FROM technician t 
        LEFT JOIN users u ON t.user_id = u.user_id
        WHERE t.status = 'pending' 
        ORDER BY t.created_at DESC 
        LIMIT 50
      ");
      ?>

      <?php if ($result->num_rows === 0): ?>
        <div class="no-data">
          <p>No pending approvals at the moment.</p>
        </div>
      <?php else: ?>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>National ID</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Skills</th>
                <th>Applied</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <?php while ($row = $result->fetch_assoc()): ?>
                <tr>
                  <td><?= $row['technician_id'] ?></td>
                  <td><?= htmlspecialchars($row['Full_Name']) ?></td>
                  <td><?= htmlspecialchars($row['national_id']) ?></td>
                  <td><?= htmlspecialchars($row['email'] ?? 'N/A') ?></td>
                  <td><?= htmlspecialchars($row['phone_no'] ?? 'N/A') ?></td>
                  <td title="<?= htmlspecialchars($row['Skill_details']) ?>">
                    <?= htmlspecialchars(substr($row['Skill_details'], 0, 30)) ?>...
                  </td>
                  <td><?= date('M j, Y', strtotime($row['created_at'])) ?></td>
                  <td>
                    <!-- SIMPLIFIED APPROVAL FORMS -->
                    <form method="POST" style="display: inline-block; margin-right: 5px;">
                      <input type="hidden" name="technician_id" value="<?= $row['technician_id'] ?>" />
                      <input type="hidden" name="action" value="approve" />
                      <button type="submit" class="action-btn approve-btn">Approve</button>
                    </form>

                    <form method="POST" style="display: inline-block;">
                      <input type="hidden" name="technician_id" value="<?= $row['technician_id'] ?>" />
                      <input type="hidden" name="action" value="reject" />
                      <button type="submit" class="action-btn reject-btn">Reject</button>
                    </form>
                  </td>
                </tr>
              <?php endwhile; ?>
            </tbody>
          </table>
        </div>
      <?php endif; ?>

    <?php elseif ($tab === 'reports'):
      // Generate reports and analytics
      $today = date('Y-m-d');
      $thisMonth = date('Y-m');
      $thisYear = date('Y');

      // Daily stats
      $dailyUsers = getCount($conn, "SELECT COUNT(*) AS count FROM users WHERE DATE(created_at) = '$today'");
      $dailyTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks WHERE DATE(created_at) = '$today'");
      $dailyCompletedTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks WHERE DATE(completed_at) = '$today'");

      // Monthly stats
      $monthlyUsers = getCount($conn, "SELECT COUNT(*) AS count FROM users WHERE DATE_FORMAT(created_at, '%Y-%m') = '$thisMonth'");
      $monthlyTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks WHERE DATE_FORMAT(created_at, '%Y-%m') = '$thisMonth'");
      $monthlyRevenue = $conn->query("SELECT SUM(t.price) as total FROM tasks t WHERE t.task_status = 'completed' AND DATE_FORMAT(t.completed_at, '%Y-%m') = '$thisMonth'")->fetch_assoc()['total'] ?? 0;

      // Category stats
      $categoryStats = $conn->query("SELECT Category, COUNT(*) as count FROM posts GROUP BY Category ORDER BY count DESC LIMIT 5");

      // Top technicians
      $topTechnicians = $conn->query("SELECT t.Full_Name, COUNT(ta.task_id) as task_count, AVG(tf.technician_rating) as avg_rating 
                                     FROM technician t 
                                     LEFT JOIN tasks ta ON t.technician_id = ta.technician_id 
                                     LEFT JOIN task_feedback tf ON ta.task_id = tf.task_id
                                     WHERE t.status = 'approved' 
                                     GROUP BY t.technician_id 
                                     HAVING task_count > 0
                                     ORDER BY task_count DESC, avg_rating DESC 
                                     LIMIT 5");
      ?>

      <div class="quick-stats">
        <div class="quick-stat">
          <h4>Today's New Users</h4>
          <p><?= $dailyUsers ?></p>
        </div>
        <div class="quick-stat">
          <h4>Today's Tasks</h4>
          <p><?= $dailyTasks ?></p>
        </div>
        <div class="quick-stat">
          <h4>Today's Completed</h4>
          <p><?= $dailyCompletedTasks ?></p>
        </div>
        <div class="quick-stat">
          <h4>Monthly Users</h4>
          <p><?= $monthlyUsers ?></p>
        </div>
        <div class="quick-stat">
          <h4>Monthly Tasks</h4>
          <p><?= $monthlyTasks ?></p>
        </div>
        <div class="quick-stat">
          <h4>Monthly Revenue</h4>
          <p>৳<?= number_format($monthlyRevenue, 0) ?></p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 25px;">
        <!-- Top Categories -->
        <div class="table-container">
          <h3 style="padding: 20px; margin: 0; color: #ff6b35; border-bottom: 1px solid rgba(255, 107, 53, 0.2);">Top
            Service Categories</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Requests</th>
              </tr>
            </thead>
            <tbody>
              <?php while ($row = $categoryStats->fetch_assoc()): ?>
                <tr>
                  <td><?= htmlspecialchars($row['Category']) ?></td>
                  <td><?= $row['count'] ?></td>
                </tr>
              <?php endwhile; ?>
            </tbody>
          </table>
        </div>

        <!-- Top Technicians -->
        <div class="table-container">
          <h3 style="padding: 20px; margin: 0; color: #ff6b35; border-bottom: 1px solid rgba(255, 107, 53, 0.2);">Top
            Technicians</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Tasks</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              <?php while ($row = $topTechnicians->fetch_assoc()): ?>
                <tr>
                  <td><?= htmlspecialchars($row['Full_Name']) ?></td>
                  <td><?= $row['task_count'] ?></td>
                  <td><?= $row['avg_rating'] ? number_format($row['avg_rating'], 1) . '/5' : 'N/A' ?></td>
                </tr>
              <?php endwhile; ?>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payment Status Report -->
      <?php
      $paymentStats = $conn->query("SELECT payment_status, COUNT(*) as count, SUM(amount) as total_amount 
                                   FROM payment 
                                   GROUP BY payment_status 
                                   ORDER BY count DESC");
      ?>
      <div class="table-container">
        <h3 style="padding: 20px; margin: 0; color: #ff6b35; border-bottom: 1px solid rgba(255, 107, 53, 0.2);">Payment
          Status Report</h3>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
              <th>Total Amount</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            <?php
            $totalPayments = getCount($conn, "SELECT COUNT(*) AS count FROM payment");
            while ($row = $paymentStats->fetch_assoc()):
              $percentage = $totalPayments > 0 ? round(($row['count'] / $totalPayments) * 100, 1) : 0;
              ?>
              <tr>
                <td><span
                    class="status-badge status-<?= $row['payment_status'] ?>"><?= ucfirst($row['payment_status']) ?></span>
                </td>
                <td><?= $row['count'] ?></td>
                <td>৳<?= number_format($row['total_amount'], 2) ?></td>
                <td><?= $percentage ?>%</td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
      </div>
    <?php endif; ?>

  </div>

  <footer id="contact">
    <div class="footer-top">
      <div>
        <h3>HelpLagbe</h3>
        <p>Help Anytime, Anywhere</p>
        <p>Bangladesh's trusted platform for connecting customers with verified technicians. Quality service guaranteed.
        </p>
      </div>
      <div>
        <h3>Services</h3>
        <ul>
          <li>Appliance Repair</li>
          <li>Electrical Work</li>
          <li>Plumbing Services</li>
          <li>General Maintenance</li>
        </ul>
      </div>
      <div>
        <h3>Company</h3>
        <ul>
          <li><a href="#">About Us</a></li>
          <li><a href="#">Our Services</a></li>
          <li><a href="#">Join as Technician</a></li>
        </ul>
      </div>
      <div>
        <h3>Contact</h3>
        <ul>
          <li>+880 1325-409985</li>
          <li>support@helplagbe.com</li>
          <li>Dhaka, Bangladesh</li>
          <li>24/7 Customer Support</li>
        </ul>
      </div>
    </div>
    <hr />
    <div class="footer-bottom">
      © <?php echo date('Y'); ?> HelpLagbe. All rights reserved. |
      <a href="#">Privacy Policy</a> |
      <a href="#">Terms of Service</a>
    </div>
  </footer>

  <script>
    // Enhanced interactions
    document.addEventListener('DOMContentLoaded', function () {
      // Add subtle animations to cards
      const cards = document.querySelectorAll('.stat-card, .quick-stat');
      cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
        card.style.animation = 'slideInUp 0.6s ease forwards';
      });

      // Add loading states for action buttons
      const actionForms = document.querySelectorAll('form[method="POST"]');
      actionForms.forEach(form => {
        form.addEventListener('submit', function (e) {
          const button = e.submitter;
          if (button) {
            const originalText = button.textContent;
            button.textContent = 'Processing...';
            button.disabled = true;
            button.style.opacity = '0.7';
            button.classList.add('loading');

            // Re-enable after a delay if form doesn't submit
            setTimeout(() => {
              if (!button.closest('form').submitted) {
                button.textContent = originalText;
                button.disabled = false;
                button.style.opacity = '1';
                button.classList.remove('loading');
              }
            }, 5000);
          }
        });
      });

      // Add smooth hover effects for table rows
      const tableRows = document.querySelectorAll('tbody tr');
      tableRows.forEach(row => {
        row.addEventListener('mouseenter', function () {
          this.style.transform = 'translateX(3px)';
        });

        row.addEventListener('mouseleave', function () {
          this.style.transform = 'translateX(0)';
        });
      });

      // Add click animations to buttons
      const buttons = document.querySelectorAll('.btn, .action-btn');
      buttons.forEach(button => {
        button.addEventListener('click', function (e) {
          const ripple = document.createElement('span');
          const rect = this.getBoundingClientRect();
          const size = Math.max(rect.width, rect.height);
          const x = e.clientX - rect.left - size / 2;
          const y = e.clientY - rect.top - size / 2;

          ripple.style.width = ripple.style.height = size + 'px';
          ripple.style.left = x + 'px';
          ripple.style.top = y + 'px';
          ripple.classList.add('ripple');

          this.appendChild(ripple);

          setTimeout(() => {
            ripple.remove();
          }, 600);
        });
      });

      // Add smooth scrolling to pagination
      const paginationLinks = document.querySelectorAll('.pagination a');
      paginationLinks.forEach(link => {
        link.addEventListener('click', function (e) {
          // Add a subtle loading effect
          this.style.opacity = '0.7';
          setTimeout(() => {
            this.style.opacity = '1';
          }, 200);
        });
      });

      // Add keyboard navigation for tabs
      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key >= '1' && e.key <= '7') {
          e.preventDefault();
          const tabs = ['overview', 'users', 'technicians', 'requests', 'tasks', 'approvals', 'reports'];
          const tabIndex = parseInt(e.key) - 1;
          if (tabs[tabIndex]) {
            window.location.href = `?tab=${tabs[tabIndex]}`;
          }
        }
      });

      // Enhanced form validation
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        form.addEventListener('submit', function (e) {
          const select = form.querySelector('select[name="new_status"]');
          if (select && !select.value && select.name === 'new_status') {
            e.preventDefault();
            alert('Please select a status to update.');
            return false;
          }
          // Mark form as submitted
          form.submitted = true;
        });
      });

      // Auto-refresh for real-time updates (optional)
      let refreshInterval;
      const currentTab = new URLSearchParams(window.location.search).get('tab') || 'overview';

      // Only auto-refresh overview and approvals tabs
      if (currentTab === 'overview' || currentTab === 'approvals') {
        refreshInterval = setInterval(() => {
          // Only refresh if user hasn't interacted recently
          if (document.hidden || Date.now() - lastInteraction > 60000) {
            window.location.reload();
          }
        }, 60000); // Refresh every 60 seconds
      }

      // Track user interaction
      let lastInteraction = Date.now();
      ['click', 'keydown', 'scroll', 'mousemove'].forEach(event => {
        document.addEventListener(event, () => {
          lastInteraction = Date.now();
        }, { passive: true });
      });

      // Cleanup interval on page unload
      window.addEventListener('beforeunload', () => {
        if (refreshInterval) {
          clearInterval(refreshInterval);
        }
      });

      // Add tooltips for truncated text
      const truncatedCells = document.querySelectorAll('td[title]');
      truncatedCells.forEach(cell => {
        cell.style.cursor = 'help';
      });

      // Enhanced status badge interactions
      const statusBadges = document.querySelectorAll('.status-badge');
      statusBadges.forEach(badge => {
        badge.addEventListener('mouseenter', function () {
          this.style.transform = 'scale(1.05)';
        });

        badge.addEventListener('mouseleave', function () {
          this.style.transform = 'scale(1)';
        });
      });

      // Add confirmation dialogs with more context
      const deleteButtons = document.querySelectorAll('.delete-btn');
      deleteButtons.forEach(button => {
        button.addEventListener('click', function (e) {
          e.preventDefault();
          const form = this.closest('form');
          const row = this.closest('tr');
          const identifier = row.cells[1]?.textContent || row.cells[0]?.textContent;

          if (confirm(`Are you sure you want to delete "${identifier}"? This action cannot be undone and may affect related data.`)) {
            form.submit();
          }
        });
      });

      // Add search functionality (basic client-side filtering)
      function addTableSearch() {
        const tables = document.querySelectorAll('.table-container table');
        tables.forEach(table => {
          const container = table.closest('.table-container');
          if (container && !container.querySelector('.table-search')) {
            const searchDiv = document.createElement('div');
            searchDiv.className = 'table-search';
            searchDiv.style.padding = '15px 20px';
            searchDiv.style.borderBottom = '1px solid rgba(255, 107, 53, 0.2)';

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search table...';
            searchInput.style.cssText = `
              background: rgba(34, 34, 34, 0.8);
              color: white;
              border: 1px solid rgba(255, 107, 53, 0.3);
              padding: 8px 12px;
              border-radius: 6px;
              width: 250px;
              font-size: 0.9rem;
            `;

            searchInput.addEventListener('input', function () {
              const filter = this.value.toLowerCase();
              const rows = table.querySelectorAll('tbody tr');

              rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(filter) ? '' : 'none';
              });
            });

            searchDiv.appendChild(searchInput);
            container.insertBefore(searchDiv, table);
          }
        });
      }

      // Add search to tables that would benefit from it
      if (['users', 'technicians', 'requests', 'tasks', 'approvals'].includes(currentTab)) {
        addTableSearch();
      }

      // Show success message and auto-hide after 5 seconds
      const successMessage = document.querySelector('.message:not(.error)');
      if (successMessage) {
        setTimeout(() => {
          successMessage.style.opacity = '0';
          setTimeout(() => {
            successMessage.style.display = 'none';
          }, 300);
        }, 5000);
      }

      // Add export functionality (basic CSV export)
      function addExportButton() {
        const tableContainers = document.querySelectorAll('.table-container');
        tableContainers.forEach(container => {
          const table = container.querySelector('table');
          if (table && !container.querySelector('.export-btn')) {
            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Export CSV';
            exportBtn.className = 'btn';
            exportBtn.style.cssText = `
              position: absolute;
              top: 20px;
              right: 20px;
              padding: 8px 16px;
              font-size: 0.85rem;
              min-width: auto;
            `;

            exportBtn.addEventListener('click', function () {
              exportTableToCSV(table, `${currentTab}_data.csv`);
            });

            container.style.position = 'relative';
            container.appendChild(exportBtn);
          }
        });
      }

      function exportTableToCSV(table, filename) {
        const csv = [];
        const rows = table.querySelectorAll('tr');

        rows.forEach(row => {
          const cols = row.querySelectorAll('td, th');
          const rowData = [];
          cols.forEach(col => {
            // Clean up the cell text and escape quotes
            let cellText = col.textContent.trim().replace(/"/g, '""');
            if (cellText.includes(',') || cellText.includes('\n')) {
              cellText = `"${cellText}"`;
            }
            rowData.push(cellText);
          });
          csv.push(rowData.join(','));
        });

        const csvContent = csv.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }

      // Add export buttons to relevant tables
      if (['users', 'technicians', 'requests', 'tasks', 'reports'].includes(currentTab)) {
        addExportButton();
      }

      console.log('Admin Dashboard initialized successfully');
    });

    // Add ripple effect styles and additional enhancements
    const style = document.createElement('style');
    style.textContent = `
      .btn, .action-btn {
        position: relative;
        overflow: hidden;
      }
      
      .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        pointer-events: none;
        transform: scale(0);
        animation: rippleAnimation 0.6s ease-out;
      }
      
      @keyframes rippleAnimation {
        to {
          transform: scale(2);
          opacity: 0;
        }
      }

      /* Additional card animation keyframes */
      @keyframes cardSlideIn {
        0% {
          opacity: 0;
          transform: translateY(20px) scale(0.95);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* Smooth transitions for all interactive elements */
      .stat-card, .table-container, .buttons-box, .message, .no-data, .quick-stat {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Enhanced focus states for accessibility */
      .btn:focus, .action-btn:focus, .pagination a:focus, select:focus, input:focus {
        outline: 2px solid #ff6b35;
        outline-offset: 2px;
      }

      /* Loading spinner for buttons */
      .btn.loading, .action-btn.loading {
        position: relative;
      }

      .btn.loading::after, .action-btn.loading::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 16px;
        height: 16px;
        margin: -8px 0 0 -8px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* Enhanced status badges */
      .status-badge {
        transition: all 0.3s ease;
        cursor: default;
      }

      /* Table search input focus */
      .table-search input:focus {
        box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.2);
      }

      /* Export button hover */
      .export-btn:hover {
        background: linear-gradient(135deg, #e05a2e, #d14d26) !important;
      }

      /* Improved responsive behavior */
      @media (max-width: 768px) {
        .table-search {
          padding: 10px !important;
        }
        
        .table-search input {
          width: 100% !important;
          max-width: none !important;
        }
        
        .export-btn {
          position: static !important;
          margin: 10px 0 !important;
          width: 100% !important;
        }
        
        .quick-stats {
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)) !important;
        }
      }
    `;
    document.head.appendChild(style);

    // Simple click handlers for approval buttons
    document.addEventListener('DOMContentLoaded', function () {
      const approveButtons = document.querySelectorAll('.approve-btn');
      const rejectButtons = document.querySelectorAll('.reject-btn');

      approveButtons.forEach(btn => {
        btn.addEventListener('click', function () {
          return confirm('Are you sure you want to approve this technician?');
        });
      });

      rejectButtons.forEach(btn => {
        btn.addEventListener('click', function () {
          return confirm('Are you sure you want to reject this technician?');
        });
      });

      // Auto-hide messages after 5 seconds
      setTimeout(function () {
        const messages = document.querySelectorAll('.message');
        messages.forEach(msg => {
          msg.style.opacity = '0';
          setTimeout(() => msg.style.display = 'none', 300);
        });
      }, 5000);
    });

  </script>

</body>

</html>