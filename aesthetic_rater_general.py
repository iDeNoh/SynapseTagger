import sys
from PIL import Image
import torch
from transformers import AutoProcessor, AutoModelForImageClassification

# --- Global variables for model and processor ---
processor = None
model = None
device = None

# --- Performance tuning ---
torch.backends.cudnn.enabled = True
torch.backends.cuda.enable_flash_sdp(True)
torch.backends.cuda.enable_math_sdp(True)

def initialize_rater():
    global processor, model, device
    try:
        print("Initializing general rater (one-time setup)...", file=sys.stderr)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Using device: {device}", file=sys.stderr)
        model_id = "cafeai/cafe_aesthetic"
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForImageClassification.from_pretrained(model_id).to(device)
        model.eval()
        print("General rater initialized and ready.", file=sys.stderr)
    except Exception as e:
        print(f"Error during general rater initialization: {e}", file=sys.stderr)
        sys.exit(1)

def get_aesthetic_score(image_path):
    if model is None:
        return "0"
    try:
        image = Image.open(image_path).convert('RGB')
        with torch.no_grad():
            inputs = processor(images=image, return_tensors="pt").to(device)
            outputs = model(**inputs)
            raw_score = outputs.logits[0][1].item()
            squashed_score = torch.tanh(torch.tensor(raw_score)).item()
            final_score = ((squashed_score + 1) / 2) * 9 + 1
            return f"{final_score:.2f}"
    except Exception as e:
        print(f"Error processing image {image_path}: {e}", file=sys.stderr)
        return "0"

if __name__ == "__main__":
    initialize_rater()
    # Loop to process images from stdin
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line:
                break
            score = get_aesthetic_score(line)
            print(score)
            sys.stdout.flush()
        except Exception as e:
            print(f"Unhandled error in main loop: {e}", file=sys.stderr)
            break