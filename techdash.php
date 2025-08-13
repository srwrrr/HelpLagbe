<?php
/***************
 * HelpLagbe - Technician Dashboard (Single File)
 * Fully functional: view + actions (bid, start, complete)
 ***************/
session_start();

/*
/* -------------------- DEBUGGING (remove in production) -------------------- */
// echo '<pre>SESSION DATA: ';
// print_r($_SESSION);
// die();


/* -------------------- DB CONNECTION (edit creds) -------------------- */
$DB_HOST = "localhost";
$DB_NAME = "helplagbe";
$DB_USER = "root";      // change to yours
$DB_PASS = "";          // change to yours

try {
    $pdo = new PDO("mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    die("Database connection failed.");
}

/* -------------------- AUTH CHECK -------------------- */
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}
$techId = (int) $_SESSION['technician_id'];

/* -------------------- FETCH TECH PROFILE -------------------- */
$tech = null;
try {
    $stmt = $pdo->prepare("
        SELECT t.technician_id, t.Full_Name, t.status, t.user_id, 
               u.username, u.email, u.phone_no, u.address, u.Image
        FROM technician t
        JOIN users u ON t.user_id = u.user_id
        WHERE t.technician_id = ?  
        LIMIT 1
    ");
    $stmt->execute([$_SESSION['technician_id']]); // Use technician_id from session
    $tech = $stmt->fetch();

    if (!$tech) {
        // More detailed error message
        die("Technician profile not found for technician_id: " . $_SESSION['technician_id'] .
            ". User_id: " . $_SESSION['user_id']);
    }
} catch (Exception $e) {
    die("Database error: " . $e->getMessage());
}

function h($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/* -------------------- FLASH MESSAGES -------------------- */
$flash = ['success' => [], 'error' => []];
function add_success($msg)
{
    global $flash;
    $flash['success'][] = $msg;
}
function add_error($msg)
{
    global $flash;
    $flash['error'][] = $msg;
}

/* -------------------- CSRF (simple) -------------------- */
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['csrf_token'];

/* -------------------- ACTION HANDLING -------------------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $token = $_POST['csrf'] ?? '';
    if (!hash_equals($csrf, $token)) {
        add_error("Invalid request token.");
    } else {
        try {
            if ($action === 'place_bid') {
                $post_id = (int) ($_POST['post_id'] ?? 0);
                $price = trim($_POST['price'] ?? '');
                if ($post_id <= 0 || $price === '' || !is_numeric($price) || $price < 0) {
                    add_error("Invalid bid details.");
                } else {
                    // Insert pending bid; rely on UNIQUE(post_id, technician_id)
                    $stmt = $pdo->prepare("
                        INSERT INTO tasks (task_status, price, post_id, technician_id, created_at, updated_at)
                        VALUES ('pending', ?, ?, ?, NOW(), NOW())
                    ");
                    $stmt->execute([$price, $post_id, $techId]);
                    add_success("Bid placed successfully.");
                }
            } elseif ($action === 'start_task') {
                $task_id = (int) ($_POST['task_id'] ?? 0);
                if ($task_id <= 0) {
                    add_error("Invalid task.");
                } else {
                    // Start only if currently accepted
                    $stmt = $pdo->prepare("
                        UPDATE tasks
                        SET task_status = 'in_progress',
                            accepted_at = COALESCE(accepted_at, NOW()),
                            updated_at = NOW()
                        WHERE task_id = ? AND technician_id = ? AND task_status = 'accepted'
                    ");
                    $stmt->execute([$task_id, $techId]);
                    if ($stmt->rowCount() > 0)
                        add_success("Task started.");
                    else
                        add_error("Task not in 'accepted' state or not found.");
                }
            } elseif ($action === 'mark_completed') {
                $task_id = (int) ($_POST['task_id'] ?? 0);
                if ($task_id <= 0) {
                    add_error("Invalid task.");
                } else {
                    // Complete only if currently in_progress
                    $stmt = $pdo->prepare("
                        UPDATE tasks
                        SET task_status = 'completed',
                            completed_at = NOW(),
                            updated_at = NOW()
                        WHERE task_id = ? AND technician_id = ? AND task_status = 'in_progress'
                    ");
                    $stmt->execute([$task_id, $techId]);
                    if ($stmt->rowCount() > 0)
                        add_success("Task marked as completed.");
                    else
                        add_error("Task not in 'in_progress' state or not found.");
                }
            } elseif ($action === 'cancel_bid') {
                $task_id = (int) ($_POST['task_id'] ?? 0);
                if ($task_id <= 0) {
                    add_error("Invalid task.");
                } else {
                    // Can cancel only if still pending
                    $stmt = $pdo->prepare("
                        DELETE FROM tasks
                        WHERE task_id = ? AND technician_id = ? AND task_status = 'pending'
                    ");
                    $stmt->execute([$task_id, $techId]);
                    if ($stmt->rowCount() > 0)
                        add_success("Pending bid canceled.");
                    else
                        add_error("Only pending bids can be canceled.");
                }
            }
        } catch (PDOException $e) {
            // Handle duplicate bid gracefully
            if ($action === 'place_bid' && $e->getCode() == 23000) {
                add_error("You already placed a bid for this post.");
            } else {
                add_error("Database error: " . h($e->getMessage()));
            }
        }
    }
}

/* -------------------- DATA QUERIES -------------------- */

/* Overview stats */
$counts = [
    'total_bids' => 0,
    'accepted' => 0,
    'in_progress' => 0,
    'completed' => 0,
    'earnings' => 0.00,
];
try {
    $counts['total_bids'] = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE technician_id = {$techId}")->fetchColumn();
    $counts['accepted'] = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE technician_id = {$techId} AND task_status = 'accepted'")->fetchColumn();
    $counts['in_progress'] = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE technician_id = {$techId} AND task_status = 'in_progress'")->fetchColumn();
    $counts['completed'] = (int) $pdo->query("SELECT COUNT(*) FROM tasks WHERE technician_id = {$techId} AND task_status = 'completed'")->fetchColumn();

    $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(p.amount),0) AS total
        FROM payment p
        JOIN tasks t ON p.task_id = t.task_id
        WHERE t.technician_id = ? AND p.payment_status = 'completed'
    ");
    $stmt->execute([$techId]);
    $counts['earnings'] = (float) ($stmt->fetchColumn() ?: 0);
} catch (Exception $e) { /* ignore, shown as 0 */
}

/* Available Tasks:
   - Posts that do NOT have any accepted/in_progress/completed task
   - AND the current tech has not already bid on them
*/
$available = [];
try {
    $stmt = $pdo->prepare("
        SELECT p.post_id, p.Post_detail, p.Image, p.Category, p.`Sub-Category`, p.created_at,
               u.username AS posted_by, u.phone_no
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        WHERE NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.post_id = p.post_id
              AND t.task_status IN ('accepted','in_progress','completed')
        )
        AND NOT EXISTS (
            SELECT 1 FROM tasks t2
            WHERE t2.post_id = p.post_id AND t2.technician_id = ?
        )
        ORDER BY p.created_at DESC
        LIMIT 200
    ");
    $stmt->execute([$techId]);
    $available = $stmt->fetchAll();
} catch (Exception $e) {
}

/* My Bids (all) */
$my_bids = [];
try {
    $stmt = $pdo->prepare("
        SELECT t.task_id, t.post_id, t.task_status, t.price, t.created_at,
               p.Post_detail
        FROM tasks t
        JOIN posts p ON t.post_id = p.post_id
        WHERE t.technician_id = ?
        ORDER BY t.created_at DESC
        LIMIT 500
    ");
    $stmt->execute([$techId]);
    $my_bids = $stmt->fetchAll();
} catch (Exception $e) {
}

/* Accepted */
$accepted = [];
try {
    $stmt = $pdo->prepare("
        SELECT t.task_id, t.post_id, t.price, t.accepted_at, p.Post_detail
        FROM tasks t
        JOIN posts p ON t.post_id = p.post_id
        WHERE t.technician_id = ? AND t.task_status = 'accepted'
        ORDER BY t.accepted_at DESC, t.created_at DESC
    ");
    $stmt->execute([$techId]);
    $accepted = $stmt->fetchAll();
} catch (Exception $e) {
}

/* Ongoing */
$ongoing = [];
try {
    $stmt = $pdo->prepare("
        SELECT t.task_id, t.post_id, t.price, t.accepted_at, p.Post_detail, t.created_at
        FROM tasks t
        JOIN posts p ON t.post_id = p.post_id
        WHERE t.technician_id = ? AND t.task_status = 'in_progress'
        ORDER BY t.updated_at DESC
    ");
    $stmt->execute([$techId]);
    $ongoing = $stmt->fetchAll();
} catch (Exception $e) {
}

/* Completed */
$completed = [];
try {
    $stmt = $pdo->prepare("
        SELECT t.task_id, t.post_id, t.price, t.completed_at, p.Post_detail
        FROM tasks t
        JOIN posts p ON t.post_id = p.post_id
        WHERE t.technician_id = ? AND t.task_status = 'completed'
        ORDER BY t.completed_at DESC
    ");
    $stmt->execute([$techId]);
    $completed = $stmt->fetchAll();
} catch (Exception $e) {
}

/* Payments */
$payments = [];
try {
    $stmt = $pdo->prepare("
        SELECT p.payment_id, p.amount, p.payment_status, p.payment_method, p.transaction_id, p.created_at,
               t.task_id, po.Post_detail
        FROM payment p
        JOIN tasks t ON p.task_id = t.task_id
        JOIN posts po ON t.post_id = po.post_id
        WHERE t.technician_id = ?
        ORDER BY p.created_at DESC
    ");
    $stmt->execute([$techId]);
    $payments = $stmt->fetchAll();
} catch (Exception $e) {
}

?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HelpLagbe - Technician Dashboard</title>
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

        /* Header */
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

        .logo img {
            height: 80px;
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
            transition: color 0.3s;
            border-bottom: 3px solid transparent;
        }

        nav a:hover {
            color: #ff6b35;
        }

        nav a.active {
            color: #ff6b35;
            border-bottom: 3px solid #ff6b35;
        }

        .contact-btn {
            background-color: #ff6b35;
            border: none;
            padding: 10px 20px;
            color: white;
            cursor: pointer;
            font-weight: bold;
            border-radius: 5px;
            transition: background 0.3s, transform 0.3s;
        }

        .contact-btn:hover {
            background-color: #e05a2e;
            transform: scale(1.05);
        }

        /* ===== Container ===== */
        .container {
            background-color: #111;
            border-radius: 15px;
            padding: 40px 50px 50px;
            width: 1500px;
            max-width: 95vw;
            margin: 60px auto 40px;
            box-shadow: 0 0 30px rgba(255, 107, 53, 0.5);
            min-height: 600px;
            display: flex;
            flex-direction: column;
        }

        /* Dashboard top */
        .dash-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .dash-top h2 {
            font-size: 2rem;
            font-weight: 700;
            color: #ff6b35;
        }

        .welcome {
            display: flex;
            align-items: center;
            gap: 15px;
            font-size: 1.1rem;
        }

        .welcome strong {
            color: #ff6b35;
        }

        .profile-circle {
            background-color: #ff6b35;
            color: #111;
            font-weight: 700;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.8rem;
            user-select: none;
        }

        /* Tabs container */
        .tabs {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 10px;
            margin-bottom: 35px;
            background: #222;
            border-radius: 16px;
            padding: 8px;
            user-select: none;
        }

        .tab {
            text-align: center;
            padding: 12px 10px;
            cursor: pointer;
            border-radius: 12px;
            color: #aaa;
            font-weight: 600;
            transition: all 0.3s ease;
            position: relative;
            font-size: 0.98rem;
        }

        .tab.active {
            color: white;
            background-color: #ff6b35;
            box-shadow: 0 0 12px #ff6b35;
            z-index: 2;
        }

        /* Tab content */
        .tab-content {
            display: none;
            flex-grow: 1;
            color: #ddd;
            font-size: 1rem;
            line-height: 1.5;
            min-height: 300px;
        }

        .tab-content.active {
            display: block;
        }

        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            color: white;
        }

        th,
        td {
            border: 1px solid #444;
            padding: 8px 12px;
            text-align: left;
            vertical-align: middle;
        }

        th {
            background-color: #ff6b35;
            color: #111;
        }

        tr:nth-child(even) {
            background-color: #222;
        }

        img.thumb {
            border-radius: 6px;
            max-width: 80px;
            max-height: 50px;
        }

        /* Forms + buttons */
        .inline-form {
            display: inline-block;
            margin: 0;
        }

        .price-input {
            width: 110px;
            padding: 6px 8px;
            border-radius: 6px;
            border: none;
            margin-right: 6px;
        }

        .btn {
            background: #ff6b35;
            border: none;
            padding: 8px 12px;
            color: #111;
            font-weight: 800;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s;
        }

        .btn:hover {
            background: #ff854f;
        }

        .btn.gray {
            background: #888;
            color: #111;
        }

        .btn.gray:hover {
            background: #aaa;
        }

        /* Stat cards */
        .stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(170px, 1fr));
            gap: 16px;
            margin-bottom: 10px;
        }

        .stat-card {
            background: #222;
            border: 1px solid #333;
            padding: 16px;
            border-radius: 12px;
            text-align: center;
        }

        .stat-title {
            color: #bbb;
            font-size: 0.95rem;
        }

        .stat-value {
            color: #fff;
            font-size: 1.6rem;
            font-weight: 800;
            margin-top: 6px;
        }

        /* Messages */
        .messages {
            margin-bottom: 20px;
            padding: 12px;
            border-radius: 8px;
        }

        .messages.error {
            background-color: #cc0000;
            color: white;
        }

        .messages.success {
            background-color: #4CAF50;
            color: white;
        }

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

        @media (max-width: 920px) {
            .tabs {
                grid-template-columns: repeat(3, 1fr);
            }

            .stats {
                grid-template-columns: repeat(2, 1fr);
            }
        }
    </style>
</head>

<body>

    <header>
        <div class="logo"><img src="logo.png" alt="HelpLagbe Logo" /></div>
        <nav>
            <a href="homepage.html">Home</a>
            <a href="#services">Services</a>
            <a href="#about">About</a>
            <a class="active" href="techdash.php">Dashboard</a>
        </nav>
        <div style="display:flex; gap:10px;">
            <button class="contact-btn" onclick="location.href='login.html'">Logout</button>
            <button class="contact-btn"
                onclick="document.getElementById('contact').scrollIntoView({behavior:'smooth'})">Contact</button>
        </div>
    </header>

    <div class="container">
        <div class="dash-top">
            <h2>Dashboard</h2>
            <div class="welcome">
                <span>Welcome, <strong><?= h($tech['Full_Name'] ?: $tech['username']) ?></strong></span>
                <div class="profile-circle"><?= strtoupper(h(substr($tech['username'], 0, 1))) ?></div>
            </div>
        </div>

        <?php if (!empty($flash['error'])): ?>
            <div class="messages error">
                <ul><?php foreach ($flash['error'] as $e): ?>
                        <li><?= h($e) ?></li><?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>
        <?php if (!empty($flash['success'])): ?>
            <div class="messages success">
                <ul><?php foreach ($flash['success'] as $m): ?>
                        <li><?= h($m) ?></li><?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>

        <div class="tabs">
            <div class="tab active" data-target="overview">Overview</div>
            <div class="tab" data-target="available">Available Tasks</div>
            <div class="tab" data-target="mybids">My Bids</div>
            <div class="tab" data-target="accepted">Accepted</div>
            <div class="tab" data-target="ongoing">Ongoing</div>
            <div class="tab" data-target="completed">Completed</div>
            <div class="tab" data-target="payments" style="grid-column: 1 / -1;">Payments</div>
        </div>

        <!-- Overview -->
        <div id="overview" class="tab-content active">
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-title">Total Bids</div>
                    <div class="stat-value"><?= (int) $counts['total_bids'] ?></div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Accepted</div>
                    <div class="stat-value"><?= (int) $counts['accepted'] ?></div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">In Progress</div>
                    <div class="stat-value"><?= (int) $counts['in_progress'] ?></div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Completed</div>
                    <div class="stat-value"><?= (int) $counts['completed'] ?></div>
                </div>
            </div>
            <div class="stat-card" style="margin-top:16px;">
                <div class="stat-title">Total Earnings</div>
                <div class="stat-value">৳ <?= number_format($counts['earnings'], 2) ?></div>
            </div>
        </div>

        <!-- Available Tasks -->
        <div id="available" class="tab-content">
            <?php if (count($available) === 0): ?>
                <p>No available tasks right now.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Image</th>
                            <th>Category</th>
                            <th>Sub-Category</th>
                            <th>Posted By</th>
                            <th>Contact</th>
                            <th>Bid Price</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($available as $row): ?>
                            <tr>
                                <td><?= h($row['Post_detail']) ?></td>
                                <td>
                                    <?php if (!empty($row['Image'])): ?>
                                        <img class="thumb" src="<?= h($row['Image']) ?>" alt="Post Image">
                                    <?php else: ?>No Image<?php endif; ?>
                                </td>
                                <td><?= h($row['Category']) ?></td>
                                <td><?= h($row['Sub-Category']) ?></td>
                                <td><?= h($row['posted_by']) ?></td>
                                <td><?= h($row['phone_no'] ?: 'N/A') ?></td>
                                <td>
                                    <form method="POST" class="inline-form">
                                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                                        <input type="hidden" name="action" value="place_bid">
                                        <input type="hidden" name="post_id" value="<?= (int) $row['post_id'] ?>">
                                        <input class="price-input" type="number" name="price" step="0.01" min="0"
                                            placeholder="৳ amount" required>
                                </td>
                                <td>
                                    <button type="submit" class="btn">Place Bid</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- My Bids -->
        <div id="mybids" class="tab-content">
            <?php if (count($my_bids) === 0): ?>
                <p>You have not placed any bids yet.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Status</th>
                            <th>Bid Price</th>
                            <th>Bid Time</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($my_bids as $b): ?>
                            <tr>
                                <td><?= h($b['Post_detail']) ?></td>
                                <td><?= h($b['task_status']) ?></td>
                                <td>৳ <?= number_format((float) $b['price'], 2) ?></td>
                                <td><?= h($b['created_at']) ?></td>
                                <td>
                                    <?php if ($b['task_status'] === 'pending'): ?>
                                        <form method="POST" class="inline-form"
                                            onsubmit="return confirm('Cancel this pending bid?');">
                                            <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                                            <input type="hidden" name="action" value="cancel_bid">
                                            <input type="hidden" name="task_id" value="<?= (int) $b['task_id'] ?>">
                                            <button type="submit" class="btn gray">Cancel Bid</button>
                                        </form>
                                    <?php else: ?>
                                        —
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- Accepted -->
        <div id="accepted" class="tab-content">
            <?php if (count($accepted) === 0): ?>
                <p>No accepted tasks yet.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Price</th>
                            <th>Accepted At</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($accepted as $a): ?>
                            <tr>
                                <td><?= h($a['Post_detail']) ?></td>
                                <td>৳ <?= number_format((float) $a['price'], 2) ?></td>
                                <td><?= h($a['accepted_at']) ?></td>
                                <td>
                                    <form method="POST" class="inline-form">
                                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                                        <input type="hidden" name="action" value="start_task">
                                        <input type="hidden" name="task_id" value="<?= (int) $a['task_id'] ?>">
                                        <button type="submit" class="btn">Start Task</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- Ongoing -->
        <div id="ongoing" class="tab-content">
            <?php if (count($ongoing) === 0): ?>
                <p>No ongoing tasks right now.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Price</th>
                            <th>Since</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($ongoing as $o): ?>
                            <tr>
                                <td><?= h($o['Post_detail']) ?></td>
                                <td>৳ <?= number_format((float) $o['price'], 2) ?></td>
                                <td><?= h($o['accepted_at'] ?: $o['created_at']) ?></td>
                                <td>
                                    <form method="POST" class="inline-form" onsubmit="return confirm('Mark as completed?');">
                                        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                                        <input type="hidden" name="action" value="mark_completed">
                                        <input type="hidden" name="task_id" value="<?= (int) $o['task_id'] ?>">
                                        <button type="submit" class="btn">Complete</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- Completed -->
        <div id="completed" class="tab-content">
            <?php if (count($completed) === 0): ?>
                <p>No completed tasks yet.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Price</th>
                            <th>Completed At</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($completed as $c): ?>
                            <tr>
                                <td><?= h($c['Post_detail']) ?></td>
                                <td>৳ <?= number_format((float) $c['price'], 2) ?></td>
                                <td><?= h($c['completed_at']) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <!-- Payments -->
        <div id="payments" class="tab-content">
            <?php if (count($payments) === 0): ?>
                <p>No payments yet.</p>
            <?php else: ?>
                <table>
                    <thead>
                        <tr>
                            <th>Payment ID</th>
                            <th>Post Detail</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Method</th>
                            <th>Txn ID</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($payments as $p): ?>
                            <tr>
                                <td><?= (int) $p['payment_id'] ?></td>
                                <td><?= h($p['Post_detail']) ?></td>
                                <td>৳ <?= number_format((float) $p['amount'], 2) ?></td>
                                <td><?= h($p['payment_status']) ?></td>
                                <td><?= h($p['payment_method']) ?></td>
                                <td><?= h($p['transaction_id']) ?></td>
                                <td><?= h($p['created_at']) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

    </div>

    <footer id="contact">
        <div class="footer-top">
            <div>
                <h3>HelpLagbe</h3>
                <p>Help Anytime, Anywhere</p>
                <p>Bangladesh's trusted platform for connecting customers with verified technicians. Quality service
                    guaranteed.</p>
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
                    <li><?= h($tech['phone_no'] ?: '+880 1325-409985') ?></li>
                    <li><?= h($tech['email'] ?: 'support@helplagbe.com') ?></li>
                    <li><?= h($tech['address'] ?: 'Dhaka, Bangladesh') ?></li>
                    <li>24/7 Customer Support</li>
                </ul>
            </div>
        </div>
        <hr />
        <div class="footer-bottom">
            © 2026 HelpLagbe. All rights reserved. |
            <a href="#">Privacy Policy</a> |
            <a href="#">Terms of Service</a>
        </div>
    </footer>

    <script>
        /* Tabs */
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(tc => tc.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.getAttribute('data-target')).classList.add('active');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    </script>

</body>

</html>