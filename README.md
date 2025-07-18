# **Synapse Tagger**

Synapse Tagger is a powerful, locally-hosted web application designed for efficiently managing and tagging large collections of images. It combines a fast, intuitive interface with an AI-powered auto-tagger to streamline your image organization workflow.

The application runs entirely on your local machine, serving files from a folder you provide without ever uploading them to the cloud, ensuring your data remains private and secure.

## **Features**

* **Local First:** Works directly with folders on your computer. No uploads required.  
* **AI Auto-Tagging:** Utilizes a powerful AI model to automatically suggest relevant tags for your images, either one by one or in a large batch.  
* **Batch Processing:** A dedicated page for tagging hundreds or thousands of images at once with options to append, prepend, or replace existing tags.  
* **Customizable Tagging:**  
  * Adjust the AI's confidence threshold to get more or fewer tags.  
  * Add custom tags to all images during a batch operation.  
* **Efficient Gallery:**  
  * Pagination system to handle large collections with ease.  
  * Filter the gallery by clicking on any tag.  
  * Sort the global tag list alphabetically or by frequency.  
* **Intuitive Editor:**  
  * Click any image to edit its tags in a simple text editor.  
  * Navigate between images using Next/Previous buttons or keyboard shortcuts.  
  * Swipe navigation for mobile devices.  
* **Cross-Platform & Network Accessible:**  
  * Works on Windows, macOS, and Linux.  
  * Can be accessed by other devices on your local network.  
* **Responsive Design:** Features a mobile-friendly layout with a slide-out tag panel.  
* **Dark Mode:** Includes a theme toggle for user comfort.

## **Installation**

Follow these steps to set up the application. This is a one-time process.

#### **Prerequisites**

Before you begin, ensure you have the following software installed on your system and available in your system's PATH:

1. **Git:** Required for cloning and updating the application. Download from [git-scm.com](https://git-scm.com/downloads).  
2. **Node.js:** The LTS (Long-Term Support) version is recommended. Download from [nodejs.org](https://nodejs.org/).  
3. **Python:** Version 3.10-3.13. Download from [python.org](https://www.python.org/downloads/).  
   * **Important:** During the Python installation on Windows, make sure to check the box that says **"Add Python to PATH"**.

#### **Setup Instructions**

The installer script is designed to be user-friendly. It will automatically clone the repository if needed, create a virtual environment, and install all dependencies.

1. Create a new, empty folder on your computer where you want to install the application.  
2. Download the appropriate installer script for your operating system into that empty folder:  
   * **Windows:** install.bat  
   * **macOS / Linux:** install.sh  
3. **For macOS/Linux Users Only:** Open a terminal in the folder and make the script executable by running:  
   chmod \+x install.sh

4. **Run the Installer:**  
   * **Windows:** Double-click install.bat.  
   * **macOS / Linux:** Run ./install.sh from your terminal.  
5. The script will first clone the project files from GitHub into the current directory.  
6. **For Windows Users Only:** The script will pause and ask you to **re-run install.bat** a second time. This is necessary to complete the installation after the project files have been downloaded.  
7. The script will then proceed to create a Python virtual environment and install all the required Python and Node.js packages. This may take several minutes.  
8. Once the script finishes, the installation is complete.

## **Usage**

1. **Start the Server:**  
   * Drag and drop the folder containing your images onto the **start.bat** (Windows) or **start-ui.sh** (macOS/Linux) script.  
   * A terminal window will open, activate the environment, and start the server. The first time you run it on a new folder, it will also generate thumbnails, which may take a moment.  
2. **Open the Application:**  
   * The start-ui.sh script will automatically open your web browser to the correct address.  
   * For start.bat, or if it doesn't open automatically, navigate to **http://localhost:3000** in your web browser.  
3. **Navigating the App:**  
   * **Gallery:** The default view. Browse your images, filter by tags, and click an image to open the editor.  
   * **Batch Tagger:** Click the "Batch Tagger" button in the header to access the page for tagging multiple images at once.  
4. **Stopping the Application:**  
   * To shut down the server, simply close the terminal window that opened when you ran the start script, or press Ctrl+C in that window.

## **License**

This project is licensed under the **MIT License**. See the LICENSE file for details.
