<?php
session_start();

if (!isset($_SESSION['user_id'])) {
    header("Location: login.html");
    exit();
}

require_once 'db.php';  // Your DB connection script

$username = $_SESSION['username'];
$user_id = $_SESSION['user_id'];

// Escape output safely
function h($string)
{
    return htmlspecialchars($string, ENT_QUOTES, 'UTF-8');
}

$errors = [];
$success_message = "";

// Handle Delete Post
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_post_id'])) {
    $delete_post_id = intval($_POST['delete_post_id']);

    $stmt_check = $conn->prepare("SELECT Image FROM posts WHERE post_id = ? AND user_id = ?");
    $stmt_check->bind_param("ii", $delete_post_id, $user_id);
    $stmt_check->execute();
    $result_check = $stmt_check->get_result();

    if ($result_check->num_rows === 1) {
        $row = $result_check->fetch_assoc();
        $image_to_delete = $row['Image'];

        $stmt_del = $conn->prepare("DELETE FROM posts WHERE post_id = ? AND user_id = ?");
        $stmt_del->bind_param("ii", $delete_post_id, $user_id);
        if ($stmt_del->execute()) {
            if ($image_to_delete && file_exists($image_to_delete)) {
                @unlink($image_to_delete);
            }
            $success_message = "Post deleted successfully.";
        } else {
            $errors[] = "Failed to delete post: " . $stmt_del->error;
        }
        $stmt_del->close();
    } else {
        $errors[] = "Post not found or you do not have permission to delete it.";
    }
    $stmt_check->close();
}

// Handle Create Post
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['create_post'])) {
    $post_detail = trim($_POST['post_detail'] ?? '');
    $category = trim($_POST['category'] ?? '');
    $sub_category = trim($_POST['sub_category'] ?? '');

    if (empty($post_detail)) {
        $errors[] = "Post detail is required.";
    }
    if (empty($category)) {
        $errors[] = "Category is required.";
    }

    $image_path = null;
    if (isset($_FILES['image']) && $_FILES['image']['error'] !== UPLOAD_ERR_NO_FILE) {
        $allowed_types = ['image/jpeg', 'image/png', 'image/gif'];
        if ($_FILES['image']['error'] !== UPLOAD_ERR_OK) {
            $errors[] = "Error uploading image.";
        } elseif (!in_array($_FILES['image']['type'], $allowed_types)) {
            $errors[] = "Only JPG, PNG, GIF images are allowed.";
        } else {
            $ext = pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION);
            $new_filename = 'uploads/' . uniqid('postimg_', true) . '.' . $ext;
            if (!move_uploaded_file($_FILES['image']['tmp_name'], $new_filename)) {
                $errors[] = "Failed to move uploaded image.";
            } else {
                $image_path = $new_filename;
            }
        }
    }

    if (empty($errors)) {
        $stmt_ins = $conn->prepare("INSERT INTO posts (Post_detail, Image, Category, `Sub-Category`, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())");
        $stmt_ins->bind_param("ssssi", $post_detail, $image_path, $category, $sub_category, $user_id);
        if ($stmt_ins->execute()) {
            $success_message = "Post created successfully.";
        } else {
            $errors[] = "Failed to create post: " . $stmt_ins->error;
            if ($image_path && file_exists($image_path)) {
                @unlink($image_path); // cleanup uploaded image if DB insert failed
            }
        }
        $stmt_ins->close();
    }
}

// Fetch user's posts
$posts = [];
$sql_posts = "SELECT post_id, Post_detail, Image, Category, `Sub-Category`, created_at
              FROM posts 
              WHERE user_id = ? 
              ORDER BY created_at DESC";
$stmt_posts = $conn->prepare($sql_posts);
$stmt_posts->bind_param("i", $user_id);
$stmt_posts->execute();
$result_posts = $stmt_posts->get_result();
while ($row = $result_posts->fetch_assoc()) {
    $posts[] = $row;
}
$stmt_posts->close();

// Fetch user profile info
$profile = [];
$sql_profile = "SELECT username, email, phone_no, address, Image FROM users WHERE user_id = ?";
$stmt_profile = $conn->prepare($sql_profile);
$stmt_profile->bind_param("i", $user_id);
$stmt_profile->execute();
$result_profile = $stmt_profile->get_result();
if ($result_profile->num_rows > 0) {
    $profile = $result_profile->fetch_assoc();
}
$stmt_profile->close();

// Fetch task history
$history = [];
$sql_history = "
    SELECT t.task_id, t.task_status, t.price, t.created_at, p.Post_detail
    FROM tasks t
    JOIN posts p ON t.post_id = p.post_id
    WHERE p.user_id = ?
    ORDER BY t.created_at DESC
";
$stmt_history = $conn->prepare($sql_history);
$stmt_history->bind_param("i", $user_id);
$stmt_history->execute();
$result_history = $stmt_history->get_result();
while ($row = $result_history->fetch_assoc()) {
    $history[] = $row;
}
$stmt_history->close();

$conn->close();
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HelpLagbe - User Dashboard</title>
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
            width: 1400px;
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
            display: flex;
            justify-content: space-between;
            margin-bottom: 35px;
            background: #222;
            border-radius: 50px;
            padding: 6px;
            user-select: none;
        }

        .tab {
            flex: 1;
            text-align: center;
            padding: 14px 0;
            cursor: pointer;
            border-radius: 50px;
            color: #aaa;
            font-weight: 600;
            transition: all 0.3s ease;
            margin: 0 7px;
            position: relative;
            font-size: 1.05rem;
        }

        .tab:first-child {
            margin-left: 0;
        }

        .tab:last-child {
            margin-right: 0;
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

        /* Table styles for posts & history */
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

        img {
            border-radius: 6px;
            max-width: 80px;
            max-height: 50px;
        }

        button.delete-btn {
            background: #ff4c4c;
            border: none;
            padding: 6px 10px;
            color: white;
            font-weight: 600;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.3s;
        }

        button.delete-btn:hover {
            background: #cc0000;
        }

        /* Create post form */
        form#create-post-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        form#create-post-form label {
            font-weight: 600;
            color: #ff6b35;
        }

        form#create-post-form input[type="text"],
        form#create-post-form textarea,
        form#create-post-form select {
            padding: 8px 10px;
            border-radius: 6px;
            border: none;
            font-size: 1rem;
            resize: vertical;
        }

        form#create-post-form textarea {
            min-height: 100px;
        }

        form#create-post-form input[type="file"] {
            color: #fff;
        }

        form#create-post-form button {
            align-self: flex-start;
            background-color: #ff6b35;
            border: none;
            padding: 10px 20px;
            color: white;
            font-weight: bold;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.3s;
        }

        form#create-post-form button:hover {
            background-color: #e05a2e;
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

        /* Responsive */
        @media (max-width: 720px) {
            .container {
                width: 90%;
                padding: 30px 25px 40px;
                margin: 40px auto 30px;
            }

            nav {
                gap: 12px;
            }
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

        /* Responsive tweaks */
        @media (max-width: 768px) {
            .section {
                padding: 30px 5%;
            }

            header {
                flex-wrap: wrap;
                gap: 10px;
            }

            nav {
                justify-content: center;
                width: 100%;
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
            <a href="userdash.php" class="active">Dashboard</a>
        </nav>
        <div style="display:flex; gap:10px;">
            <button class="contact-btn" onclick="location.href='login.html'">Logout</button>
            <button class="contact-btn" onclick="scrollToContact()">Contact</button>
        </div>
    </header>

    <div class="container">
        <div class="dash-top">
            <h2>Dashboard</h2>
            <div class="welcome">
                <span>Welcome back, <strong><?php echo h($username); ?></strong></span>
                <div class="profile-circle"><?php echo strtoupper(h($username[0])); ?></div>
            </div>
        </div>

        <?php if (!empty($errors)): ?>
            <div class="messages error">
                <ul>
                    <?php foreach ($errors as $error): ?>
                        <li><?php echo h($error); ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php elseif ($success_message): ?>
            <div class="messages success">
                <?php echo h($success_message); ?>
            </div>
        <?php endif; ?>

        <div class="tabs">
            <div class="tab active" data-target="myposts">My Posts</div>
            <div class="tab" data-target="createpost">Create Post</div>
            <div class="tab" data-target="myprofile">My Profile</div>
            <div class="tab" data-target="history">History</div>
        </div>

        <!-- My Posts -->
        <div id="myposts" class="tab-content active">
            <?php if (count($posts) > 0): ?>
                <table>
                    <thead>
                        <tr>
                            <th>Post Detail</th>
                            <th>Image</th>
                            <th>Category</th>
                            <th>Sub-Category</th>
                            <th>Created At</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($posts as $post): ?>
                            <tr>
                                <td><?php echo h($post['Post_detail']); ?></td>
                                <td>
                                    <?php if (!empty($post['Image'])): ?>
                                        <img src="<?php echo h($post['Image']); ?>" alt="Post Image">
                                    <?php else: ?>
                                        No Image
                                    <?php endif; ?>
                                </td>
                                <td><?php echo h($post['Category']); ?></td>
                                <td><?php echo h($post['Sub-Category']); ?></td>
                                <td><?php echo h($post['created_at']); ?></td>
                                <td>
                                    <form method="POST" style="margin:0;"
                                        onsubmit="return confirm('Are you sure you want to delete this post?');">
                                        <input type="hidden" name="delete_post_id"
                                            value="<?php echo (int) $post['post_id']; ?>">
                                        <button type="submit" class="delete-btn">Delete</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php else: ?>
                <p>You have no posts yet.</p>
            <?php endif; ?>
        </div>

        <!-- Create Post -->
        <div id="createpost" class="tab-content">
            <form id="create-post-form" method="POST" enctype="multipart/form-data" novalidate>
                <input type="hidden" name="create_post" value="1">
                <label for="post_detail">Post Detail *</label>
                <textarea name="post_detail" id="post_detail" required></textarea>

                <label for="category">Category *</label>
                <input type="text" name="category" id="category" required>

                <label for="sub_category">Sub-Category</label>
                <input type="text" name="sub_category" id="sub_category">

                <label for="image">Upload Image (JPG, PNG, GIF)</label>
                <input type="file" name="image" id="image" accept="image/jpeg,image/png,image/gif">

                <button type="submit">Create Post</button>
            </form>
        </div>

        <!-- My Profile -->
        <div id="myprofile" class="tab-content">
            <?php if (!empty($profile)): ?>
                <table>
                    <tr>
                        <th>Username</th>
                        <td><?php echo h($profile['username']); ?></td>
                    </tr>
                    <tr>
                        <th>Email</th>
                        <td><?php echo h($profile['email']); ?></td>
                    </tr>
                    <tr>
                        <th>Phone Number</th>
                        <td><?php echo h($profile['phone_no']); ?></td>
                    </tr>
                    <tr>
                        <th>Address</th>
                        <td><?php echo h($profile['address']); ?></td>
                    </tr>
                    <tr>
                        <th>Profile Image</th>
                        <td>
                            <?php if (!empty($profile['Image'])): ?>
                                <img src="<?php echo h($profile['Image']); ?>" alt="Profile Image" style="max-width:120px;">
                            <?php else: ?>
                                No image uploaded
                            <?php endif; ?>
                        </td>
                    </tr>
                </table>
            <?php else: ?>
                <p>Profile information not found.</p>
            <?php endif; ?>
        </div>

        <!-- History -->
        <div id="history" class="tab-content">
            <?php if (count($history) > 0): ?>
                <table>
                    <thead>
                        <tr>
                            <th>Task ID</th>
                            <th>Task Status</th>
                            <th>Price</th>
                            <th>Created At</th>
                            <th>Related Post Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($history as $task): ?>
                            <tr>
                                <td><?php echo h($task['task_id']); ?></td>
                                <td><?php echo h($task['task_status']); ?></td>
                                <td><?php echo h($task['price']); ?></td>
                                <td><?php echo h($task['created_at']); ?></td>
                                <td><?php echo h($task['Post_detail']); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php else: ?>
                <p>No past tasks found.</p>
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
                    <li>+880 1325-409985</li>
                    <li>support@helplagbe.com</li>
                    <li>Dhaka, Bangladesh</li>
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
        // Scroll to contact section
        function scrollToContact() {
            document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
        }

        // Tabs functionality
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(tc => tc.classList.remove('active'));

                tab.classList.add('active');
                const target = tab.getAttribute('data-target');
                document.getElementById(target).classList.add('active');
            });
        });
    </script>

</body>

</html>