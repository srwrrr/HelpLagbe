<?php
session_start();
require 'db.php'; // Your DB connection, sets $conn

// Protect admin page if needed
// if (!isset($_SESSION['admin_logged_in'])) {
//     header('Location: login.php');
//     exit;
// }

// Handle Approve/Reject POST for technicians
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['technician_id'], $_POST['action'])) {
  $tid = (int) $_POST['technician_id'];
  $action = $_POST['action'];

  if ($action === 'approve' || $action === 'reject') {
    $newStatus = $action === 'approve' ? 'approved' : 'rejected';
    $stmt = $conn->prepare("UPDATE technician SET status = ? WHERE technician_id = ?");
    $stmt->bind_param("si", $newStatus, $tid);
    $stmt->execute();
    $stmt->close();
    $msg = "Technician status updated successfully.";
  }
}

// Pagination & tab handling
$perPage = 10;
$page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
$offset = ($page - 1) * $perPage;

$allowed_tabs = ['overview', 'users', 'technicians', 'requests', 'tasks', 'approvals'];
$tab = isset($_GET['tab']) && in_array($_GET['tab'], $allowed_tabs) ? $_GET['tab'] : 'users';

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

    .reject-btn {
      background: rgba(68, 68, 68, 0.8);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .reject-btn:hover {
      background: rgba(85, 85, 85, 0.9);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
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
    </div>

    <?php if ($tab === 'overview'):
      // Fetch stats
      $totalUsers = getCount($conn, "SELECT COUNT(*) AS count FROM users");
      $totalTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician");
      $pendingTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician WHERE status = 'pending'");
      $totalTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks");
      $totalRequests = getCount($conn, "SELECT COUNT(*) AS count FROM posts");
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
          <h3>Total Tasks</h3>
          <p><?= $totalTasks ?></p>
        </div>
        <div class="stat-card">
          <h3>Total Requests</h3>
          <p><?= $totalRequests ?></p>
        </div>
      </div>

    <?php elseif ($tab === 'users'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM users", $perPage);
      $result = $conn->query("SELECT user_id, username, email, phone_no, created_at FROM users ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['user_id'] ?></td>
                <td><?= htmlspecialchars($row['username']) ?></td>
                <td><?= htmlspecialchars($row['email']) ?></td>
                <td><?= htmlspecialchars($row['phone_no']) ?></td>
                <td><?= $row['created_at'] ?></td>
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
      $result = $conn->query("SELECT technician_id, Full_Name, national_id, status, created_at FROM technician WHERE status != 'pending' ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>National ID</th>
              <th>Status</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['technician_id'] ?></td>
                <td><?= htmlspecialchars($row['Full_Name']) ?></td>
                <td><?= htmlspecialchars($row['national_id']) ?></td>
                <td><?= ucfirst($row['status']) ?></td>
                <td><?= $row['created_at'] ?></td>
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
      $result = $conn->query("SELECT post_id, Post_detail, Category, `Sub-Category`, user_id, created_at FROM posts ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Detail</th>
              <th>Category</th>
              <th>Sub-Category</th>
              <th>User ID</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['post_id'] ?></td>
                <td><?= htmlspecialchars($row['Post_detail']) ?></td>
                <td><?= htmlspecialchars($row['Category']) ?></td>
                <td><?= htmlspecialchars($row['Sub-Category']) ?></td>
                <td><?= $row['user_id'] ?></td>
                <td><?= $row['created_at'] ?></td>
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
      $result = $conn->query("SELECT task_id, task_status, price, post_id, technician_id, created_at FROM tasks ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Price</th>
              <th>Post ID</th>
              <th>Technician ID</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            <?php while ($row = $result->fetch_assoc()): ?>
              <tr>
                <td><?= $row['task_id'] ?></td>
                <td><?= ucfirst($row['task_status']) ?></td>
                <td>৳<?= number_format($row['price'], 2) ?></td>
                <td><?= $row['post_id'] ?></td>
                <td><?= $row['technician_id'] ?></td>
                <td><?= $row['created_at'] ?></td>
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
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM technician WHERE status = 'pending'", $perPage);
      $result = $conn->query("SELECT technician_id, Full_Name, national_id, created_at FROM technician WHERE status = 'pending' ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
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
                <th>Applied At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <?php while ($row = $result->fetch_assoc()): ?>
                <tr>
                  <td><?= $row['technician_id'] ?></td>
                  <td><?= htmlspecialchars($row['Full_Name']) ?></td>
                  <td><?= htmlspecialchars($row['national_id']) ?></td>
                  <td><?= $row['created_at'] ?></td>
                  <td>
                    <form method="POST" style="display:inline;">
                      <input type="hidden" name="technician_id" value="<?= $row['technician_id'] ?>" />
                      <button type="submit" name="action" value="approve" class="action-btn approve-btn"
                        onclick="return confirm('Approve this technician?');">Approve</button>
                      <button type="submit" name="action" value="reject" class="action-btn reject-btn"
                        onclick="return confirm('Reject this technician?');">Reject</button>
                    </form>
                  </td>
                </tr>
              <?php endwhile; ?>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <?php for ($i = 1; $i <= $totalPages; $i++): ?>
            <a href="?tab=approvals&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
          <?php endfor; ?>
        </div>
      <?php endif; ?>
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
      const cards = document.querySelectorAll('.stat-card');
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

            // Re-enable after a delay if form doesn't submit
            setTimeout(() => {
              button.textContent = originalText;
              button.disabled = false;
              button.style.opacity = '1';
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
        if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
          e.preventDefault();
          const tabs = ['overview', 'users', 'technicians', 'requests', 'tasks', 'approvals'];
          const tabIndex = parseInt(e.key) - 1;
          if (tabs[tabIndex]) {
            window.location.href = `?tab=${tabs[tabIndex]}`;
          }
        }
      });

      // Auto-refresh for real-time updates (optional)
      // Uncomment the following lines if you want auto-refresh
      /*
      setInterval(() => {
        const currentTab = new URLSearchParams(window.location.search).get('tab') || 'users';
        if (currentTab === 'overview' || currentTab === 'approvals') {
          // Only refresh overview and approvals tabs for real-time updates
          window.location.reload();
        }
      }, 30000); // Refresh every 30 seconds
      */
    });

    // Add ripple effect styles
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
      .stat-card, .table-container, .buttons-box, .message, .no-data {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Enhanced focus states for accessibility */
      .btn:focus, .action-btn:focus, .pagination a:focus {
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
    `;
    document.head.appendChild(style);
  </script>

</body>

</html>