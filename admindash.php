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
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background-color: #1b1b1b;
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    a {
      text-decoration: none;
      color: white;
      transition: color 0.3s;
    }

    nav a {
      font-weight: 600;
      font-size: 1rem;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      transition: color 0.3s;
      background-color: transparent !important;
      box-shadow: none !important;
      border-bottom: 3px solid transparent;
    }

    nav a:hover {
      color: #ff6b35;
      background-color: transparent;
      box-shadow: none;
    }

    nav a.active {
      color: #ff6b35;
      border-bottom: 3px solid #ff6b35;
      background-color: transparent;
      box-shadow: none;
    }

    img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: #111;
      padding: 15px 30px;
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 4px solid #ff6b35;
    }

    .logo {
      display: flex;
      align-items: center;
    }

    .logo img {
      height: 80px;
    }

    nav {
      display: flex;
      gap: 20px;
    }

    /* Container */
    .container {
      background-color: #111;
      border-radius: 15px;
      padding: 40px 50px 50px;
      width: 1200px;
      margin: 60px auto 40px;
      box-shadow: 0 0 30px rgba(255, 107, 53, 0.5);
      min-height: 650px;
      display: flex;
      flex-direction: column;
    }

    /* Admin Access text */
    .admin-access {
      font-weight: 700;
      font-size: 1.2rem;
      color: #ff6b35;
      margin-bottom: 30px;
      user-select: none;
    }

    /* Buttons box */
    .buttons-box {
      background-color: #222;
      border-radius: 15px;
      padding: 15px 20px;
      margin-bottom: 30px;
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
    }

    .btn {
      background-color: #ff6b35;
      border: none;
      padding: 10px 22px;
      color: white;
      cursor: pointer;
      font-weight: 700;
      border-radius: 8px;
      transition: background-color 0.3s ease;
      user-select: none;
      flex-grow: 1;
      text-align: center;
      min-width: 120px;
    }

    .btn:hover {
      background-color: #e05a2e;
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 0 15px rgba(255, 107, 53, 0.4);
      background-color: #222;
    }

    th,
    td {
      padding: 12px 15px;
      border-bottom: 1px solid #333;
      color: #ddd;
      text-align: left;
    }

    th {
      background-color: #ff6b35;
      color: #111;
      font-weight: 700;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .message {
      background-color: #2a7f2a;
      padding: 14px 20px;
      margin-bottom: 25px;
      border-radius: 15px;
      color: #d4ffd4;
      font-weight: 700;
      box-shadow: 0 0 12px #2a7f2a;
      text-align: center;
      user-select: none;
    }

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
      padding: 6px 12px;
      border-radius: 50px;
      transition: background-color 0.3s ease, color 0.3s ease;
      background-color: transparent;
      box-shadow: none;
      display: inline-block;
    }

    .pagination a.active,
    .pagination a:hover {
      color: white;
      background-color: #ff6b35;
      box-shadow: 0 0 15px #ff6b35;
      text-decoration: none;
    }

    /* Footer */
    footer {
      background-color: #111;
      padding: 40px 10%;
      color: white;
      border-top: 4px solid #ff6b35;
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
      margin-bottom: 10px;
    }

    footer p {
      line-height: 1.5;
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
    }

    footer ul li a {
      color: white;
      font-size: 0.95rem;
    }

    footer ul li a:hover {
      color: #ff6b35;
    }

    .footer-bottom {
      text-align: center;
      padding-top: 10px;
      font-size: 0.9rem;
      color: #aaa;
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
      }

      nav {
        justify-content: center;
        width: 100%;
      }

      .buttons-box {
        flex-direction: column;
        gap: 15px;
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
      <button class="btn" onclick="location.href='admin.html'">Admin</button>
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
        style="background-color: <?= $tab === 'overview' ? '#e05a2e' : '#ff6b35' ?>;">Overview</a>
      <a href="?tab=users" class="btn"
        style="background-color: <?= $tab === 'users' ? '#e05a2e' : '#ff6b35' ?>;">Users</a>
      <a href="?tab=technicians" class="btn"
        style="background-color: <?= $tab === 'technicians' ? '#e05a2e' : '#ff6b35' ?>;">Technicians</a>
      <a href="?tab=requests" class="btn"
        style="background-color: <?= $tab === 'requests' ? '#e05a2e' : '#ff6b35' ?>;">Service Requests</a>
      <a href="?tab=tasks" class="btn"
        style="background-color: <?= $tab === 'tasks' ? '#e05a2e' : '#ff6b35' ?>;">Tasks</a>
      <a href="?tab=approvals" class="btn"
        style="background-color: <?= $tab === 'approvals' ? '#e05a2e' : '#ff6b35' ?>;">Approvals</a>
    </div>

    <?php if ($tab === 'overview'):
      // Fetch stats
      $totalUsers = getCount($conn, "SELECT COUNT(*) AS count FROM users");
      $totalTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician");
      $pendingTechnicians = getCount($conn, "SELECT COUNT(*) AS count FROM technician WHERE status = 'pending'");
      $totalTasks = getCount($conn, "SELECT COUNT(*) AS count FROM tasks");
      $totalRequests = getCount($conn, "SELECT COUNT(*) AS count FROM posts");
      ?>
      <div
        style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 25px; margin-bottom: 30px;">
        <div
          style="background:#222; padding:20px; border-radius:12px; text-align:center; box-shadow:0 0 15px rgba(255,107,53,0.4);">
          <h3>Total Users</h3>
          <p style="font-size:1.5rem; font-weight:700;"><?= $totalUsers ?></p>
        </div>
        <div
          style="background:#222; padding:20px; border-radius:12px; text-align:center; box-shadow:0 0 15px rgba(255,107,53,0.4);">
          <h3>Total Technicians</h3>
          <p style="font-size:1.5rem; font-weight:700;"><?= $totalTechnicians ?></p>
        </div>
        <div
          style="background:#222; padding:20px; border-radius:12px; text-align:center; box-shadow:0 0 15px rgba(255,107,53,0.4);">
          <h3>Pending Approvals</h3>
          <p style="font-size:1.5rem; font-weight:700;"><?= $pendingTechnicians ?></p>
        </div>
        <div
          style="background:#222; padding:20px; border-radius:12px; text-align:center; box-shadow:0 0 15px rgba(255,107,53,0.4);">
          <h3>Total Tasks</h3>
          <p style="font-size:1.5rem; font-weight:700;"><?= $totalTasks ?></p>
        </div>
        <div
          style="background:#222; padding:20px; border-radius:12px; text-align:center; box-shadow:0 0 15px rgba(255,107,53,0.4);">
          <h3>Total Requests</h3>
          <p style="font-size:1.5rem; font-weight:700;"><?= $totalRequests ?></p>
        </div>
      </div>


    <?php elseif ($tab === 'users'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM users", $perPage);
      $result = $conn->query("SELECT user_id, username, email, phone_no, created_at FROM users ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
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
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=users&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'technicians'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM technician WHERE status != 'pending'", $perPage);
      $result = $conn->query("SELECT technician_id, Full_Name, national_id, status, created_at FROM technician WHERE status != 'pending' ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
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
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=technicians&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'requests'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM posts", $perPage);
      $result = $conn->query("SELECT post_id, Post_detail, Category, `Sub-Category`, user_id, created_at FROM posts ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
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
      <div class="pagination">
        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
          <a href="?tab=requests&page=<?= $i ?>" class="<?= $i == $page ? 'active' : '' ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>

    <?php elseif ($tab === 'tasks'):
      $totalPages = getTotalPages($conn, "SELECT COUNT(*) AS count FROM tasks", $perPage);
      $result = $conn->query("SELECT task_id, task_status, price, post_id, technician_id, created_at FROM tasks ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
      ?>
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
        <p>No pending approvals at the moment.</p>
      <?php else: ?>
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
                    <button type="submit" name="action" value="approve" class="btn"
                      style="padding:5px 12px; font-weight:600; font-size:0.9rem; margin-right:6px;"
                      onclick="return confirm('Approve this technician?');">Approve</button>
                    <button type="submit" name="action" value="reject" class="btn"
                      style="background-color:#444; padding:5px 12px; font-weight:600; font-size:0.9rem;"
                      onclick="return confirm('Reject this technician?');">Reject</button>
                  </form>
                </td>
              </tr>
            <?php endwhile; ?>
          </tbody>
        </table>
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

</body>

</html>