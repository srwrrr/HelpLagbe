-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 12, 2025 at 05:56 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `helplagbe`
--

-- --------------------------------------------------------

--
-- Table structure for table `admin`
--

CREATE TABLE `admin` (
  `admin_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admin`
--

INSERT INTO `admin` (`admin_id`, `created_at`) VALUES
(1, '2025-08-09 19:05:58'),
(2, '2025-08-12 14:41:38');

-- --------------------------------------------------------

--
-- Table structure for table `admin_dashboard`
--

CREATE TABLE `admin_dashboard` (
  `ad_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `post_id` int(11) DEFAULT NULL,
  `task_id` int(11) DEFAULT NULL,
  `admin_id` int(11) DEFAULT NULL,
  `technician_id` int(11) DEFAULT NULL,
  `Type` varchar(100) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `available_tasks`
-- (See below for the actual view)
--
CREATE TABLE `available_tasks` (
`post_id` int(11)
,`Post_detail` text
,`Image` varchar(255)
,`Category` varchar(100)
,`Sub-Category` varchar(100)
,`user_id` int(11)
,`created_at` timestamp
,`updated_at` timestamp
,`posted_by` varchar(255)
,`contact_phone` varchar(20)
);

-- --------------------------------------------------------

--
-- Table structure for table `contact`
--

CREATE TABLE `contact` (
  `contact_id` int(11) NOT NULL,
  `Name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone_no` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('new','read','responded') DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payment`
--

CREATE TABLE `payment` (
  `payment_id` int(11) NOT NULL,
  `payment_status` enum('pending','completed','failed','refunded') DEFAULT 'pending',
  `amount` decimal(10,2) NOT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `transaction_id` varchar(255) DEFAULT NULL,
  `task_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `posts`
--

CREATE TABLE `posts` (
  `post_id` int(11) NOT NULL,
  `Post_detail` text NOT NULL,
  `Image` varchar(255) DEFAULT NULL,
  `Category` varchar(100) NOT NULL,
  `Sub-Category` varchar(100) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `posts`
--

INSERT INTO `posts` (`post_id`, `Post_detail`, `Image`, `Category`, `Sub-Category`, `user_id`, `created_at`, `updated_at`) VALUES
(1, 'My AC is not cooling properly. Need urgent repair.', NULL, 'appliance', NULL, 1, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(2, 'Kitchen sink is leaking. Need plumber immediately.', NULL, 'plumbing', NULL, 1, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(3, 'Electrical outlet not working in bedroom.', NULL, 'electrical', NULL, 1, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(4, 'checking if my site is working', NULL, 'maintenance', NULL, 6, '2025-08-11 20:41:29', '2025-08-11 20:41:29'),
(5, 'Testing my webpage', NULL, 'Electrical', 'Computer', 1, '2025-08-12 13:45:03', '2025-08-12 13:45:03');

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `task_id` int(11) NOT NULL,
  `task_status` enum('pending','accepted','in_progress','completed','cancelled') DEFAULT 'pending',
  `price` decimal(10,2) NOT NULL,
  `post_id` int(11) NOT NULL,
  `technician_id` int(11) NOT NULL,
  `accepted_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tasks`
--

INSERT INTO `tasks` (`task_id`, `task_status`, `price`, `post_id`, `technician_id`, `accepted_at`, `completed_at`, `created_at`, `updated_at`) VALUES
(1, 'accepted', 500.00, 3, 2, NULL, NULL, '2025-08-09 19:33:23', '2025-08-09 19:42:42');

-- --------------------------------------------------------

--
-- Table structure for table `task_feedback`
--

CREATE TABLE `task_feedback` (
  `feedback_id` int(11) NOT NULL,
  `consumer_rating` int(11) DEFAULT NULL CHECK (`consumer_rating` >= 1 and `consumer_rating` <= 5),
  `consumer_feedback` text DEFAULT NULL,
  `technician_rating` int(11) DEFAULT NULL CHECK (`technician_rating` >= 1 and `technician_rating` <= 5),
  `technician_feedback` text DEFAULT NULL,
  `task_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `technician`
--

CREATE TABLE `technician` (
  `technician_id` int(11) NOT NULL,
  `national_id` varchar(50) NOT NULL,
  `Full_Name` varchar(255) NOT NULL,
  `Required_Documents` text DEFAULT NULL,
  `Skill_details` text NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `address` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `technician`
--

INSERT INTO `technician` (`technician_id`, `national_id`, `Full_Name`, `Required_Documents`, `Skill_details`, `status`, `user_id`, `created_at`, `updated_at`, `address`) VALUES
(1, '1234567890123', 'Mohammad Rahman', NULL, 'AC repair, refrigerator maintenance, electrical work. 5 years experience.', 'approved', 2, '2025-08-09 19:05:58', '2025-08-09 19:05:58', NULL),
(2, '1234567890124', 'Abdul Karim', NULL, 'Plumbing, pipe fitting, water system installation. 8 years experience.', 'approved', 3, '2025-08-09 19:05:58', '2025-08-09 19:05:58', NULL),
(4, '21331123', 'Test tech', NULL, 'VERY VEREY GOOD', 'approved', 7, '2025-08-11 20:46:01', '2025-08-12 15:12:32', NULL),
(5, '213111333', 'Samir tech', 'uploads/logo main.png', 'i am just figuring things out', 'approved', 9, '2025-08-12 13:50:49', '2025-08-12 15:12:34', NULL),
(6, '23123123', 'Address', 'uploads/logo main.png', 'address', 'approved', 10, '2025-08-12 13:57:57', '2025-08-12 15:12:36', '38/1, Haji Abul Khair Nibas, Tenari Mor, Jigatola, Dhanmondi'),
(7, '2312321', 'Pending', 'uploads/admin dash.png', 'idk man', 'approved', 14, '2025-08-12 15:44:58', '2025-08-12 15:45:16', '38/1, Haji Abul Khair Nibas, Tenari Mor, Jigatola, Dhanmondi');

-- --------------------------------------------------------

--
-- Table structure for table `technician_dashboard`
--

CREATE TABLE `technician_dashboard` (
  `td_id` int(11) NOT NULL,
  `task_id` int(11) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `username` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone_no` varchar(20) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `address` text DEFAULT NULL,
  `Image` varchar(255) DEFAULT NULL,
  `admin_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `username`, `email`, `phone_no`, `password`, `address`, `Image`, `admin_id`, `created_at`, `updated_at`) VALUES
(1, 'john_doe', 'john@example.com', '+8801234567890', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Dhanmondi, Dhaka', NULL, NULL, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(2, 'jane_smith', 'jane@example.com', '+8801234567891', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Gulshan, Dhaka', NULL, NULL, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(3, 'ahmed_khan', 'ahmed@example.com', '+8801234567892', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Uttara, Dhaka', NULL, NULL, '2025-08-09 19:05:58', '2025-08-09 19:05:58'),
(6, 'Something', 'something@gmail.com', '01905576802', '$2y$10$hxpxtimgUGQxt1Updv3w0OMO/.IDbED7lLTALHJ07evbugYjAcoza', 'bangladesh dhaka', NULL, NULL, '2025-08-11 20:40:46', '2025-08-11 20:40:46'),
(7, 'Test tech', 'testtech@gmail.com', '0145678922', '$2y$10$DuzM56C2b3QG8qm9yVhihezat8mitvYH/HdEThotukt/nG5mUvUbu', NULL, NULL, NULL, '2025-08-11 20:46:01', '2025-08-11 20:46:01'),
(8, 'helppls', 'helpls@gmail.com', '01325409985', '$2y$10$MBs6yPwbkSYZIBUKW1r/8ej/0k9sJy/H9xURKndQ2TbhORE3SUTlW', 'bangladesh dhaka', NULL, NULL, '2025-08-12 12:55:48', '2025-08-12 12:55:48'),
(9, 'Samir tech', 'samirtech@gmail.com', '01869197806', '$2y$10$UP1omrPM5tN4seBhOR5IjuFqJTCtp7kxNciy5Ug6W7SzI5rL6MNnS', NULL, NULL, NULL, '2025-08-12 13:50:49', '2025-08-12 13:50:49'),
(10, 'Address', 'address@gmail.com', '01869197806', '$2y$10$7YC6ihcWFkxYXX3LUsvzXeRVR97B7u087mjqmXF0E731xGCscqbWm', NULL, NULL, NULL, '2025-08-12 13:57:57', '2025-08-12 13:57:57'),
(13, 'Sarwar', 'sarwar@example.com', '0123456789', '$2y$10$CwTycUXWue0Thq9StjUM0uJ8k2Ujy2Ry8H2PsFYYXxMOM6f9YU5LG', NULL, NULL, 2, '2025-08-12 14:41:57', '2025-08-12 14:41:57'),
(14, 'Pending', 'pending@gmail.com', '01904476903', '$2y$10$oaAQhUbq4R5vw0qPTCrcw.nDE.csJoDlNxwD1BW2TR0/iL5O7Qtgi', NULL, NULL, NULL, '2025-08-12 15:44:58', '2025-08-12 15:44:58');

-- --------------------------------------------------------

--
-- Stand-in structure for view `user_posts_with_bids`
-- (See below for the actual view)
--
CREATE TABLE `user_posts_with_bids` (
`post_id` int(11)
,`Post_detail` text
,`Image` varchar(255)
,`Category` varchar(100)
,`Sub-Category` varchar(100)
,`user_id` int(11)
,`created_at` timestamp
,`updated_at` timestamp
,`bid_count` bigint(21)
,`latest_status` enum('pending','accepted','in_progress','completed','cancelled')
,`username` varchar(255)
);

-- --------------------------------------------------------

--
-- Table structure for table `website_feedback`
--

CREATE TABLE `website_feedback` (
  `feedback_id` int(11) NOT NULL,
  `rating` int(11) NOT NULL CHECK (`rating` >= 1 and `rating` <= 5),
  `feedback` text NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure for view `available_tasks`
--
DROP TABLE IF EXISTS `available_tasks`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `available_tasks`  AS SELECT `p`.`post_id` AS `post_id`, `p`.`Post_detail` AS `Post_detail`, `p`.`Image` AS `Image`, `p`.`Category` AS `Category`, `p`.`Sub-Category` AS `Sub-Category`, `p`.`user_id` AS `user_id`, `p`.`created_at` AS `created_at`, `p`.`updated_at` AS `updated_at`, `u`.`username` AS `posted_by`, `u`.`phone_no` AS `contact_phone` FROM (`posts` `p` join `users` `u` on(`p`.`user_id` = `u`.`user_id`)) WHERE !(`p`.`post_id` in (select distinct `tasks`.`post_id` from `tasks` where `tasks`.`task_status` = 'accepted')) ORDER BY `p`.`created_at` DESC ;

-- --------------------------------------------------------

--
-- Structure for view `user_posts_with_bids`
--
DROP TABLE IF EXISTS `user_posts_with_bids`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `user_posts_with_bids`  AS SELECT `p`.`post_id` AS `post_id`, `p`.`Post_detail` AS `Post_detail`, `p`.`Image` AS `Image`, `p`.`Category` AS `Category`, `p`.`Sub-Category` AS `Sub-Category`, `p`.`user_id` AS `user_id`, `p`.`created_at` AS `created_at`, `p`.`updated_at` AS `updated_at`, count(`t`.`task_id`) AS `bid_count`, max(`t`.`task_status`) AS `latest_status`, `u`.`username` AS `username` FROM ((`posts` `p` left join `tasks` `t` on(`p`.`post_id` = `t`.`post_id`)) join `users` `u` on(`p`.`user_id` = `u`.`user_id`)) GROUP BY `p`.`post_id` ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admin`
--
ALTER TABLE `admin`
  ADD PRIMARY KEY (`admin_id`);

--
-- Indexes for table `admin_dashboard`
--
ALTER TABLE `admin_dashboard`
  ADD PRIMARY KEY (`ad_id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `post_id` (`post_id`),
  ADD KEY `task_id` (`task_id`),
  ADD KEY `admin_id` (`admin_id`),
  ADD KEY `technician_id` (`technician_id`);

--
-- Indexes for table `contact`
--
ALTER TABLE `contact`
  ADD PRIMARY KEY (`contact_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_email` (`email`);

--
-- Indexes for table `payment`
--
ALTER TABLE `payment`
  ADD PRIMARY KEY (`payment_id`),
  ADD KEY `idx_task_id` (`task_id`),
  ADD KEY `idx_status` (`payment_status`);

--
-- Indexes for table `posts`
--
ALTER TABLE `posts`
  ADD PRIMARY KEY (`post_id`),
  ADD KEY `idx_category` (`Category`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_posts_created_at` (`created_at`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`task_id`),
  ADD UNIQUE KEY `unique_post_technician` (`post_id`,`technician_id`),
  ADD KEY `idx_post_id` (`post_id`),
  ADD KEY `idx_technician_id` (`technician_id`),
  ADD KEY `idx_status` (`task_status`),
  ADD KEY `idx_tasks_created_at` (`created_at`);

--
-- Indexes for table `task_feedback`
--
ALTER TABLE `task_feedback`
  ADD PRIMARY KEY (`feedback_id`),
  ADD KEY `idx_task_id` (`task_id`);

--
-- Indexes for table `technician`
--
ALTER TABLE `technician`
  ADD PRIMARY KEY (`technician_id`),
  ADD UNIQUE KEY `national_id` (`national_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `technician_dashboard`
--
ALTER TABLE `technician_dashboard`
  ADD PRIMARY KEY (`td_id`),
  ADD KEY `task_id` (`task_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `admin_id` (`admin_id`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_users_created_at` (`created_at`);

--
-- Indexes for table `website_feedback`
--
ALTER TABLE `website_feedback`
  ADD PRIMARY KEY (`feedback_id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `idx_rating` (`rating`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admin`
--
ALTER TABLE `admin`
  MODIFY `admin_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `admin_dashboard`
--
ALTER TABLE `admin_dashboard`
  MODIFY `ad_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `contact`
--
ALTER TABLE `contact`
  MODIFY `contact_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payment`
--
ALTER TABLE `payment`
  MODIFY `payment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `posts`
--
ALTER TABLE `posts`
  MODIFY `post_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `task_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `task_feedback`
--
ALTER TABLE `task_feedback`
  MODIFY `feedback_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `technician`
--
ALTER TABLE `technician`
  MODIFY `technician_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `technician_dashboard`
--
ALTER TABLE `technician_dashboard`
  MODIFY `td_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `website_feedback`
--
ALTER TABLE `website_feedback`
  MODIFY `feedback_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `admin_dashboard`
--
ALTER TABLE `admin_dashboard`
  ADD CONSTRAINT `admin_dashboard_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `admin_dashboard_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `posts` (`post_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `admin_dashboard_ibfk_3` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`task_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `admin_dashboard_ibfk_4` FOREIGN KEY (`admin_id`) REFERENCES `admin` (`admin_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `admin_dashboard_ibfk_5` FOREIGN KEY (`technician_id`) REFERENCES `technician` (`technician_id`) ON DELETE SET NULL;

--
-- Constraints for table `payment`
--
ALTER TABLE `payment`
  ADD CONSTRAINT `payment_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`task_id`) ON DELETE CASCADE;

--
-- Constraints for table `posts`
--
ALTER TABLE `posts`
  ADD CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`post_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tasks_ibfk_2` FOREIGN KEY (`technician_id`) REFERENCES `technician` (`technician_id`) ON DELETE CASCADE;

--
-- Constraints for table `task_feedback`
--
ALTER TABLE `task_feedback`
  ADD CONSTRAINT `task_feedback_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`task_id`) ON DELETE CASCADE;

--
-- Constraints for table `technician`
--
ALTER TABLE `technician`
  ADD CONSTRAINT `technician_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `technician_dashboard`
--
ALTER TABLE `technician_dashboard`
  ADD CONSTRAINT `technician_dashboard_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`task_id`) ON DELETE CASCADE;

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admin` (`admin_id`) ON DELETE SET NULL;

--
-- Constraints for table `website_feedback`
--
ALTER TABLE `website_feedback`
  ADD CONSTRAINT `website_feedback_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
