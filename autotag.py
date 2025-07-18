import sys
import json
from PIL import Image
import torch
from torchvision import transforms
from huggingface_hub import hf_hub_download
import timm 

# Global variables for model and transforms, loaded once
model = None
transform = None
allowed_tags = None
device = None
current_threshold = 0.3 # Default threshold

def initialize_autotagger(threshold=0.3):
    """
    Initializes the multi-label model and other necessary components.
    This function should be called once.
    """
    global model, transform, allowed_tags, device, current_threshold
    current_threshold = threshold
    try:
        print("Initializing auto-tagger (one-time setup)...", file=sys.stderr)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Using device: {device}", file=sys.stderr)
        repo_id = "Thouph/eva02-vit-large-448-8046"

        print("Locating model files (downloading if necessary)...", file=sys.stderr)
        model_path = hf_hub_download(repo_id=repo_id, filename="model.pth")
        tags_path = hf_hub_download(repo_id=repo_id, filename="tags_8041.json")

        print("Creating compatible model structure...", file=sys.stderr)
        compatible_model = timm.create_model(
            'eva02_large_patch14_448.mim_in22k_ft_in1k',
            num_classes=8046,
            pretrained=False
        ).to(device)

        print("Loading incompatible model file in memory...", file=sys.stderr)
        incompatible_model = torch.load(model_path, map_location=device, weights_only=False)

        print("Extracting and loading weights into compatible model...", file=sys.stderr)
        compatible_model.load_state_dict(incompatible_model.state_dict(), strict=False)

        model = compatible_model
        model.eval()
        print("Model loaded successfully.", file=sys.stderr)

        transform = transforms.Compose([
            transforms.Resize((448, 448)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.48145466, 0.4578275, 0.40821073],
                                 std=[0.26862954, 0.26130258, 0.27577711])
        ])

        with open(tags_path, "r") as f:
            tags_list = json.load(f)
        
        allowed_tags = sorted(tags_list)
        allowed_tags.insert(0, "placeholder0") 
        allowed_tags.append("placeholder1")
        allowed_tags.append("explicit")
        allowed_tags.append("questionable")
        allowed_tags.append("safe")
        print("Tagger initialized and ready.", file=sys.stderr)

    except Exception as e:
        print(f"Error during auto-tagger initialization: {e}", file=sys.stderr)
        sys.exit(1)

def get_tags_for_image(image_path):
    """
    Generates tags for a single image using the already loaded model.
    """
    global model, transform, allowed_tags, device, current_threshold
    if model is None:
        print("Error: Auto-tagger not initialized.", file=sys.stderr)
        return "" # Return empty string or raise error

    try:
        image = Image.open(image_path).convert('RGB')
        tensor = transform(image).unsqueeze(0).to(device)

        with torch.no_grad():
            output = model(tensor)
            probabilities = torch.nn.functional.sigmoid(output[0])
        
        indices = torch.where(probabilities > current_threshold)[0]
        
        found_tags = [
            allowed_tags[i].replace('_', ' ')
            for i in indices.cpu().numpy()
        ]
        
        return ','.join(found_tags)

    except Exception as e:
        print(f"Error processing image {image_path}: {e}", file=sys.stderr)
        return "" # Return empty string on error for a specific image

if __name__ == "__main__":
    # The script now takes the initial threshold as a command-line argument,
    # then enters a loop to process images from stdin.
    initial_threshold = float(sys.argv[1]) if len(sys.argv) > 1 else 0.3
    initialize_autotagger(initial_threshold)

    # Main loop to continuously read image paths from stdin
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line: # EOF or empty line
                break
            
            image_path = line
            # print(f"Processing image: {image_path}", file=sys.stderr) # Debugging line
            tags = get_tags_for_image(image_path)
            print(tags) # Print tags to stdout, followed by a newline
            sys.stdout.flush() # Ensure output is sent immediately

        except Exception as e:
            print(f"Unhandled error in main loop: {e}", file=sys.stderr)
            sys.stdout.flush() # Still flush output
            break # Exit loop on unhandled error