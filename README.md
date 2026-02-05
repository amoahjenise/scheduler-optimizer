# Scheduler Optimizer

**AI-Driven Constraint Optimization for Legacy Industrial & Healthcare Schedules**

---

The Scheduler Optimizer is a technical proof-of-concept designed to bridge the gap between siloed, legacy scheduling data (screenshots, PDFs, paper scans) and modern, optimized staffing. By utilizing OCR (Optical Character Recognition) for data ingestion and AI Agent logic for constraint satisfaction, this application transforms static images into editable, optimized workforce plans.

This project was developed as a solo engineering initiative to explore the intersection of **Computer Vision**, **AI-driven decision-making**, and **modern identity management** within a PHP-based ecosystem.

---

## 🧩 Key Features

### 1. Intelligent Data Ingestion (OCR)

- **Legacy Ingestion:** Upload multiple screenshots of existing schedules.
- **OCR Pipeline:** Extracts text data from unstructured images to identify shifts, staff names, and current assignments.
- **Validation:** Basic validation for image dimensions and file types to ensure high-fidelity extraction.

### 2. Constraint-Based AI Optimization

- **Rule Definition:** Approvers can set specific optimization parameters:
  - Maximum consecutive shifts.
  - Minimum requirements for specialized staff (e.g., Chemo-certified nurses).
  - Employee preferences and availability notes.
- **AI Agent Integration:** Leverages AI agents to process extracted data against defined rules to generate an optimized staffing calendar that satisfies all constraints.

### 3. Visual Schedule Canvas

- **Pre-Optimization View:** A table-like interface allowing users to review extracted data, tag shifts, and add manual comments.
- **Editable Calendar:** A post-optimization view where the Approver can make final manual adjustments to the AI-generated results.

### 4. Secure Approver Workflow

- **Identity Management:** Integrated with Clerk Auth for secure Approver-only access.
- **Data Persistence:** Synchronizes Clerk `user_id` with a relational database for consistent state management.

---

## 🛠 Tech Stack

| Layer              | Technology                              |
| ------------------ | --------------------------------------- |
| **Core**           | PHP 8.x                                 |
| **Frontend**       | HTML5, CSS3, JavaScript (Visual Canvas) |
| **Authentication** | Clerk Auth                              |
| **Data Extraction**| Tesseract OCR / AI-based Vision API     |
| **Logic Engine**   | AI Agent (LLM-based constraint satisfaction) |
| **Database**       | MySQL / PostgreSQL                      |

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SCHEDULER OPTIMIZER                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
│  │  INGESTION      │    │  CONTEXT        │    │  REASONING          │  │
│  │  LAYER          │───▶│  LAYER          │───▶│  LAYER              │  │
│  │                 │    │                 │    │                     │  │
│  │  • File Upload  │    │  • Digitized    │    │  • AI Agent         │  │
│  │  • OCR Engine   │    │    Schedule     │    │  • Constraint       │  │
│  │  • Digitization │    │  • User Rules   │    │    Satisfaction     │  │
│  └─────────────────┘    └─────────────────┘    └──────────┬──────────┘  │
│                                                           │             │
│                                                           ▼             │
│                                              ┌─────────────────────┐    │
│                                              │  UI/REVIEW          │    │
│                                              │  LAYER              │    │
│                                              │                     │    │
│                                              │  • Editable Canvas  │    │
│                                              │  • Human-in-Loop    │    │
│                                              │  • Final Approval   │    │
│                                              └─────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Ingestion Layer:** PHP handles the file upload and interacts with the OCR engine to digitize the schedule.
2. **Context Layer:** The digitized data is paired with "Optimization Rules" defined by the user.
3. **Reasoning Layer:** An AI Agent receives the schedule context and the constraint rules, then performs a combinatorial optimization to produce a suggested plan.
4. **UI/Review Layer:** The result is rendered onto an editable canvas for human-in-the-loop verification.

---

## 🚀 Getting Started

### Prerequisites

- PHP 8.1+
- Composer
- A Clerk Auth account and API Keys
- An OCR engine (e.g., Tesseract) or Vision API credentials

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/amoahjenise/scheduler-optimizer.git
   cd scheduler-optimizer
   ```

2. **Install dependencies:**

   ```bash
   composer install
   ```

3. **Configure Environment:**

   Create a `.env` file in the root directory:

   ```ini
   CLERK_SECRET_KEY=your_secret_key
   CLERK_PUBLISHABLE_KEY=your_publishable_key
   DB_HOST=localhost
   DB_NAME=scheduler_db
   DB_USER=root
   DB_PASS=password
   AI_API_KEY=your_ai_service_key
   ```

4. **Database Migration:**

   Initialize your database tables:

   ```bash
   php migrate.php
   ```

5. **Run Locally:**

   ```bash
   php -S localhost:8000
   ```

---

## 📈 Future Enhancements

- [ ] **Real-time Collaboration:** Using WebSockets to allow multiple schedulers to edit the canvas simultaneously.
- [ ] **Heuristic Engine:** Moving from LLM-based reasoning to a dedicated solver (like OptaPlanner) for larger datasets.
- [ ] **Export Options:** Direct export to SAP (PM/PP modules) or CSV.

---

## 🤝 Collaboration

This project is a showcase of bridging legacy industrial data with modern AI logic. Inquiries regarding the architecture or optimization algorithms are welcome.

---

## 📄 License

This project is available for review and educational purposes.
