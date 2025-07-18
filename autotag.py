import sys
import json
from PIL import Image
import torch
from torchvision import transforms
from huggingface_hub import hf_hub_download
import timm 

def get_tags(image_path, probability_threshold=0.3):
    """
    Generates tags for an image using the specified multi-label model.
    """
    try:
        print("Initializing auto-tagger...", file=sys.stderr)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Using device: {device}", file=sys.stderr)
        repo_id = "Thouph/eva02-vit-large-448-8046"

        print("Locating model files (downloading if necessary)...", file=sys.stderr)
        model_path = hf_hub_download(repo_id=repo_id, filename="model.pth")
        tags_path = hf_hub_download(repo_id=repo_id, filename="tags_8041.json")

        # --- ROBUST LOADING METHOD ---
        print("Creating compatible model structure...", file=sys.stderr)
        # 1. Create a fresh, compatible model architecture from the timm library.
        compatible_model = timm.create_model(
            'eva02_large_patch14_448.mim_in22k_ft_in1k',
            num_classes=8046,
            pretrained=False
        ).to(device)

        print("Loading incompatible model file in memory...", file=sys.stderr)
        # 2. Load the entire incompatible model object from the downloaded file.
        incompatible_model = torch.load(model_path, map_location=device, weights_only=False)

        print("Extracting and loading weights into compatible model...", file=sys.stderr)
        # 3. Extract the weights (state_dict) from the old model.
        # 4. Load those weights into our new, clean model, ignoring minor mismatches.
        compatible_model.load_state_dict(incompatible_model.state_dict(), strict=False)

        # 5. Use the new, clean, and compatible model for inference.
        model = compatible_model
        model.eval()
        print("Model loaded successfully.", file=sys.stderr)

        # --- The rest of the script remains the same ---
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

        print(f"Processing image: {image_path}", file=sys.stderr)
        image = Image.open(image_path).convert('RGB')
        tensor = transform(image).unsqueeze(0).to(device)

        with torch.no_grad():
            output = model(tensor)
            probabilities = torch.nn.functional.sigmoid(output[0])
        
        indices = torch.where(probabilities > probability_threshold)[0]
        
        found_tags = [
            allowed_tags[i].replace('_', ' ')
            for i in indices.cpu().numpy()
        ]
        
        print(f"Found {len(found_tags)} tags.", file=sys.stderr)
        print(','.join(found_tags))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    image_path_arg = sys.argv[1]
    threshold_arg = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
    get_tags(image_path_arg, probability_threshold=threshold_arg)