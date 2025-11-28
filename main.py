#!/usr/bin/env python3
"""
Thermometer Reader - Webcam application that reads temperature from a thermometer using GPT-4 Vision.

Usage:
    uv run main.py

Controls:
    - Drag mouse to select crop region (thermometer area)
    - Press 'c' to clear crop region
    - Press 'q' to quit

Reads temperature automatically every 5 seconds.
Saves data to temperature_log.csv and displays a plot at the bottom.
"""

import base64
import csv
import os
import re
import threading
import time
from datetime import datetime
from io import BytesIO

import cv2
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import numpy as np
from openai import OpenAI
from PIL import Image


class ThermometerReader:
    def __init__(self):
        self.cap = cv2.VideoCapture(0)
        if not self.cap.isOpened():
            raise RuntimeError("Could not open webcam")

        # Crop region (x, y, width, height)
        self.crop_region = None
        self.selecting = False
        self.selection_start = None
        self.selection_end = None

        # Temperature reading
        self.temperature = "No reading"
        self.last_read_time = 0
        self.auto_read = True
        self.auto_read_interval = 5  # seconds

        # Temperature history for plotting
        self.temp_history = []  # List of (timestamp, temperature_value)
        self.max_history_points = 60  # Show last 60 readings (5 minutes at 5s intervals)

        # CSV file for logging
        self.csv_file = "temperature_log.csv"
        self._init_csv()

        # OpenAI client
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("Warning: OPENAI_API_KEY not set. Temperature reading will not work.")
            self.client = None
        else:
            self.client = OpenAI(api_key=api_key)

        # Thread lock for temperature updates
        self.lock = threading.Lock()
        self.reading_in_progress = False

        # Window name
        self.window_name = "Thermometer Reader"
        cv2.namedWindow(self.window_name)
        cv2.setMouseCallback(self.window_name, self.mouse_callback)

    def _init_csv(self):
        """Initialize CSV file with headers if it doesn't exist."""
        if not os.path.exists(self.csv_file):
            with open(self.csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['timestamp', 'temperature_raw', 'temperature_value', 'unit'])
        print(f"Logging data to: {os.path.abspath(self.csv_file)}")

    def _parse_temperature(self, temp_str: str) -> tuple[float | None, str | None]:
        """Parse temperature string to extract numeric value and unit."""
        # Match patterns like "98.6°F", "37.0°C", "98.6 F", "37 C", etc.
        match = re.search(r'([\d.]+)\s*°?\s*([FCfc])', temp_str)
        if match:
            value = float(match.group(1))
            unit = match.group(2).upper()
            return value, unit
        return None, None

    def _save_to_csv(self, timestamp: datetime, temp_raw: str, temp_value: float | None, unit: str | None):
        """Append temperature reading to CSV file."""
        with open(self.csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                timestamp.isoformat(),
                temp_raw,
                temp_value if temp_value is not None else '',
                unit if unit is not None else ''
            ])

    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for crop selection."""
        if event == cv2.EVENT_LBUTTONDOWN:
            self.selecting = True
            self.selection_start = (x, y)
            self.selection_end = (x, y)

        elif event == cv2.EVENT_MOUSEMOVE and self.selecting:
            self.selection_end = (x, y)

        elif event == cv2.EVENT_LBUTTONUP:
            self.selecting = False
            self.selection_end = (x, y)

            # Calculate crop region
            x1 = min(self.selection_start[0], self.selection_end[0])
            y1 = min(self.selection_start[1], self.selection_end[1])
            x2 = max(self.selection_start[0], self.selection_end[0])
            y2 = max(self.selection_start[1], self.selection_end[1])

            width = x2 - x1
            height = y2 - y1

            if width > 10 and height > 10:  # Minimum size
                self.crop_region = (x1, y1, width, height)
                print(f"Crop region set: {self.crop_region}")
            else:
                print("Selection too small, try again")

    def encode_image_to_base64(self, image: np.ndarray) -> str:
        """Convert OpenCV image to base64 string."""
        # Convert BGR to RGB
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_image)

        # Save to bytes
        buffer = BytesIO()
        pil_image.save(buffer, format="JPEG", quality=90)
        buffer.seek(0)

        return base64.standard_b64encode(buffer.read()).decode("utf-8")

    def read_temperature(self, image: np.ndarray):
        """Send image to GPT-4 Vision and extract temperature reading."""
        if self.client is None:
            with self.lock:
                self.temperature = "API key not set"
            return

        with self.lock:
            if self.reading_in_progress:
                return
            self.reading_in_progress = True

        def do_read():
            try:
                base64_image = self.encode_image_to_base64(image)

                response = self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "This image shows a thermometer. Please read the temperature displayed on the thermometer. Respond with ONLY the temperature value and unit (e.g., '98.6°F' or '37.0°C'). If you cannot read the temperature clearly, respond with 'Unable to read'."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{base64_image}"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=50
                )

                result = response.choices[0].message.content.strip()
                timestamp = datetime.now()
                temp_value, unit = self._parse_temperature(result)

                # Create display-friendly version (OpenCV doesn't handle ° well)
                if temp_value is not None and unit is not None:
                    display_result = f"{temp_value} {unit}"
                else:
                    display_result = result.replace('°', ' ')

                with self.lock:
                    self.temperature = display_result
                    self.last_read_time = time.time()

                    # Add to history if we got a valid numeric reading
                    if temp_value is not None:
                        self.temp_history.append((timestamp, temp_value, unit))
                        # Keep only last N points
                        if len(self.temp_history) > self.max_history_points:
                            self.temp_history = self.temp_history[-self.max_history_points:]

                # Save to CSV
                self._save_to_csv(timestamp, result, temp_value, unit)

                print(f"Temperature reading: {result}")

            except Exception as e:
                with self.lock:
                    self.temperature = f"Error: {str(e)[:30]}"
                print(f"Error reading temperature: {e}")
            finally:
                with self.lock:
                    self.reading_in_progress = False

        # Run in background thread
        thread = threading.Thread(target=do_read)
        thread.daemon = True
        thread.start()

    def create_plot_image(self, width: int, height: int) -> np.ndarray:
        """Create a plot of temperature history as an OpenCV image."""
        fig, ax = plt.subplots(figsize=(width/100, height/100), dpi=100)
        fig.patch.set_facecolor('#1a1a1a')
        ax.set_facecolor('#1a1a1a')

        with self.lock:
            history = list(self.temp_history)

        if len(history) >= 2:
            timestamps = [h[0] for h in history]
            values = [h[1] for h in history]
            units = [h[2] for h in history]

            # Convert timestamps to seconds ago
            now = datetime.now()
            seconds_ago = [(now - t).total_seconds() for t in timestamps]

            # Plot
            ax.plot(seconds_ago, values, color='#00ffff', linewidth=2, marker='o', markersize=4)
            ax.fill_between(seconds_ago, values, alpha=0.3, color='#00ffff')

            # Formatting
            ax.set_xlabel('Seconds ago', color='white', fontsize=8)
            unit_label = units[-1] if units else '°'
            ax.set_ylabel(f'Temperature ({unit_label})', color='white', fontsize=8)
            ax.tick_params(colors='white', labelsize=7)
            ax.invert_xaxis()  # Most recent on the right
            ax.grid(True, alpha=0.3, color='white')

            # Set spine colors
            for spine in ax.spines.values():
                spine.set_color('white')
                spine.set_alpha(0.3)
        else:
            ax.text(0.5, 0.5, 'Collecting data...', ha='center', va='center',
                    color='white', fontsize=10, transform=ax.transAxes)
            ax.set_xticks([])
            ax.set_yticks([])

        plt.tight_layout(pad=0.5)

        # Convert plot to image
        fig.canvas.draw()
        plot_img = np.frombuffer(fig.canvas.tostring_rgb(), dtype=np.uint8)
        plot_img = plot_img.reshape(fig.canvas.get_width_height()[::-1] + (3,))
        plot_img = cv2.cvtColor(plot_img, cv2.COLOR_RGB2BGR)

        plt.close(fig)

        return plot_img

    def draw_overlay(self, frame: np.ndarray) -> np.ndarray:
        """Draw UI overlay on frame."""
        overlay = frame.copy()
        height, width = frame.shape[:2]

        # Draw crop region if set
        if self.crop_region:
            x, y, w, h = self.crop_region
            cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 255, 0), 2)

        # Draw selection rectangle while selecting
        if self.selecting and self.selection_start and self.selection_end:
            cv2.rectangle(overlay, self.selection_start, self.selection_end, (255, 0, 0), 2)

        # Draw temperature reading in bottom right
        with self.lock:
            temp_text = self.temperature
            reading_status = "Reading..." if self.reading_in_progress else ""

        # Background box for temperature
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 1.2
        thickness = 2

        (text_width, text_height), baseline = cv2.getTextSize(temp_text, font, font_scale, thickness)

        padding = 15
        box_x = width - text_width - padding * 2 - 10
        box_y = height - text_height - padding * 2 - 10

        # Semi-transparent background
        cv2.rectangle(overlay, (box_x, box_y), (width - 10, height - 10), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, overlay)

        # Temperature text
        text_x = box_x + padding
        text_y = height - padding - 10
        cv2.putText(overlay, temp_text, (text_x, text_y), font, font_scale, (0, 255, 255), thickness)

        # Status indicators
        status_y = 30
        cv2.putText(overlay, "Controls: [C]lear crop [Q]uit", (10, status_y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        if reading_status:
            cv2.putText(overlay, reading_status, (width // 2 - 50, status_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        if self.crop_region:
            cv2.putText(overlay, "Crop region set (green box)", (10, status_y + 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        else:
            cv2.putText(overlay, "Drag mouse to select thermometer region", (10, status_y + 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 1)

        return overlay

    def get_cropped_image(self, frame: np.ndarray) -> np.ndarray:
        """Get the cropped region of the frame, or full frame if no crop set."""
        if self.crop_region:
            x, y, w, h = self.crop_region
            return frame[y:y+h, x:x+w].copy()
        return frame.copy()

    def run(self):
        """Main loop."""
        print("\n" + "="*50)
        print("Thermometer Reader Started")
        print("="*50)
        print("\nControls:")
        print("  - Drag mouse to select crop region (thermometer area)")
        print("  - Press 'c' to clear crop region")
        print("  - Press 'q' to quit")
        print("\nReads temperature automatically every 5 seconds.")
        print(f"Data saved to: {os.path.abspath(self.csv_file)}")
        print("="*50 + "\n")

        # Plot dimensions
        plot_height = 150

        while True:
            ret, frame = self.cap.read()
            if not ret:
                print("Failed to grab frame")
                break

            # Auto-read
            current_time = time.time()
            with self.lock:
                should_read = (current_time - self.last_read_time >= self.auto_read_interval
                               and not self.reading_in_progress)
            if should_read:
                cropped = self.get_cropped_image(frame)
                self.read_temperature(cropped)

            # Draw overlay on video frame
            display_frame = self.draw_overlay(frame)

            # Create plot
            frame_height, frame_width = display_frame.shape[:2]
            plot_img = self.create_plot_image(frame_width, plot_height)

            # Resize plot to match frame width if needed
            if plot_img.shape[1] != frame_width:
                plot_img = cv2.resize(plot_img, (frame_width, plot_height))

            # Stack video and plot vertically
            combined = np.vstack([display_frame, plot_img])

            # Show combined frame
            cv2.imshow(self.window_name, combined)

            # Handle key presses
            key = cv2.waitKey(1) & 0xFF

            if key == ord('q'):
                break
            elif key == ord('c'):
                self.crop_region = None
                print("Crop region cleared")

        self.cap.release()
        cv2.destroyAllWindows()


def main():
    try:
        reader = ThermometerReader()
        reader.run()
    except Exception as e:
        print(f"Error: {e}")
        return 1
    return 0


if __name__ == "__main__":
    exit(main())
