from ultralytics import YOLO
import cv2

model = YOLO("models/best.pt")
cap = cv2.VideoCapture(0)

print("Camera started. Press Q to stop.")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Could not read camera frame.")
        break

    results = model(frame, verbose=False)

    count = len(results[0].boxes)

    print("Heads:", count)

    cv2.imshow("YOLO Head Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()