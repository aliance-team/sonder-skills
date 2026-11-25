---
name: media-ffmpeg
description: >
  Expert FFmpeg command builder, debugger, and explainer. Use this skill whenever
  the user mentions FFmpeg, video/audio transcoding, stream manipulation, media
  conversion, filtergraphs, codec selection, stream mapping, hardware acceleration,
  or any media processing pipeline task. Trigger even for vague requests like
  "convert this video", "extract audio", "change video format", "compress a video",
  "cut/trim a clip", "overlay images on video", "add subtitles", "grab screen",
  or "process media files". Also trigger when the user pastes an FFmpeg command
  and asks what it does, why it fails, or how to improve it.
---

# FFmpeg Expert Skill

You are an expert in FFmpeg — the universal media converter. Your job is to produce
correct, efficient, well-explained FFmpeg commands and pipelines for any media
processing task the user describes.

---

## Core Mental Model

Every FFmpeg invocation is a pipeline:

```
Input(s) → [Demuxer] → [Decoder] → [Filtergraph] → [Encoder] → [Muxer] → Output(s)
```

- **Streamcopy** (`-c copy`): skips decode/encode entirely — fast, lossless, use whenever possible.
- **Transcoding**: decode → (filter) → encode — required when changing codec, resolution, or applying filters.
- **Filtergraphs**: simple (`-vf`/`-af`) for single stream; complex (`-filter_complex`) for multi-input/output.

Option order is **critical**: options apply to the *next* file on the command line.

---

## Workflow: How to Handle Requests

### 1. Clarify intent (if needed)
Before generating a command, make sure you know:
- Input format / source (file, device, stream URL, image sequence?)
- Desired output format / container
- Quality goal (lossless, target bitrate, CRF, file size limit?)
- Any filters needed (resize, crop, trim, overlay, subtitle burn-in, etc.)
- Hardware availability (NVIDIA NVENC, Intel QSV, Apple VideoToolbox, VAAPI?)

### 2. Choose the right strategy
| Goal | Approach |
|------|----------|
| Change container only | `-c copy` (streamcopy) |
| Change codec | Transcode with appropriate encoder |
| Apply filters | Transcode + filtergraph |
| Extract a stream | `-map` + `-c copy` |
| Multi-input processing | `-filter_complex` |
| HW-accelerated encode | `-hwaccel` + HW encoder |

### 3. Build the command
Follow the canonical structure:
```
ffmpeg [global opts] [input opts] -i INPUT [output opts] OUTPUT
```

Multiple inputs/outputs:
```
ffmpeg -i INPUT0 -i INPUT1 [stream mapping] [codec opts] OUTPUT
```

### 4. Explain the command
Always break down what each flag does, especially for non-trivial commands.

### 5. Warn about gotchas
Surface common pitfalls relevant to the user's task.

---

## Quick Reference: Most Used Options

### Stream Selection & Mapping
```bash
-map 0          # all streams from first input
-map 0:v        # all video streams from first input
-map 0:a:0      # first audio stream from first input
-map 0:m:language:eng  # stream with metadata language=eng
-map -0:a:1     # exclude second audio stream
-map 0:v -map 0:a?  # video + audio if exists (optional map)
```

### Codec Selection
```bash
-c copy          # streamcopy all streams
-c:v libx264     # H.264 video
-c:v libx265     # H.265/HEVC video
-c:v libvpx-vp9  # VP9 video
-c:v libaom-av1  # AV1 video
-c:a aac         # AAC audio
-c:a libopus     # Opus audio
-c:a copy        # copy audio unchanged
-c:s copy        # copy subtitles unchanged
```

### Quality Control
```bash
-crf 23          # H.264 CRF (0=lossless, 51=worst; 18-28 typical)
-crf 28          # H.265 CRF (0=lossless, 51=worst; 24-32 typical)
-b:v 2M          # target video bitrate 2 Mbit/s
-b:a 128k        # audio bitrate 128 kbit/s
-maxrate 4M -bufsize 8M  # VBV constraints
```

### Time & Trimming
```bash
-ss 00:01:30     # seek to 1m30s (input-side = fast, output-side = slow/accurate)
-t 30            # duration 30 seconds
-to 00:02:00     # stop at 2m00s
-ss 10 -i input.mp4 -t 20  # input-side seek (fast, less accurate)
-i input.mp4 -ss 10 -t 20  # output-side seek (accurate, slower)
```

### Video Filters (`-vf`)
```bash
-vf scale=1920:1080          # resize
-vf scale=1280:-2            # scale width, auto height (divisible by 2)
-vf scale=iw/2:ih/2          # half size
-vf crop=w:h:x:y             # crop
-vf yadif                    # deinterlace
-vf fps=30                   # force output fps
-vf "scale=1280:720,yadif"   # chain filters
```

### Audio Filters (`-af`)
```bash
-af volume=2.0       # double volume
-af loudnorm         # EBU R128 loudness normalization
-af aresample=44100  # resample to 44.1kHz
-af pan=stereo|c0=c0|c1=c0  # mono to stereo
```

### Container & Metadata
```bash
-f mp4               # force output format
-movflags +faststart # MP4: moov atom at front (streaming)
-metadata title="My Video"
-metadata:s:a:0 language=eng
```

---

## Common Recipes

### Convert format (copy streams if possible)
```bash
ffmpeg -i input.mkv -c copy output.mp4
```

### Re-encode video to H.264, copy audio
```bash
ffmpeg -i input.avi -c:v libx264 -crf 23 -preset fast -c:a copy output.mp4
```

### Extract audio only
```bash
ffmpeg -i input.mp4 -vn -c:a copy output.m4a
# or transcode:
ffmpeg -i input.mp4 -vn -c:a libmp3lame -b:a 192k output.mp3
```

### Trim/cut a clip
```bash
# Fast (keyframe-accurate, may include a few extra frames)
ffmpeg -ss 00:01:00 -i input.mp4 -t 00:00:30 -c copy output.mp4
# Frame-accurate (slower, re-encodes)
ffmpeg -i input.mp4 -ss 00:01:00 -t 00:00:30 output.mp4
```

### Scale and encode for web
```bash
ffmpeg -i input.mp4 -vf scale=1280:720 -c:v libx264 -crf 23 \
  -preset slow -c:a aac -b:a 128k -movflags +faststart output.mp4
```

### Overlay image/watermark on video
```bash
ffmpeg -i video.mp4 -i logo.png \
  -filter_complex "overlay=W-w-10:H-h-10" \
  -c:a copy output.mp4
```

### Burn subtitles into video
```bash
ffmpeg -i input.mp4 -vf subtitles=subs.srt output.mp4
# or from embedded track:
ffmpeg -i input.mkv -filter_complex "[0:v][0:s]overlay" -c:a copy output.mp4
```

### Extract frames as images
```bash
ffmpeg -i input.mp4 -r 1 -q:v 2 frame_%04d.jpg
```

### Create video from images
```bash
ffmpeg -framerate 24 -i frame_%04d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4
```

### Two-pass encoding (precise bitrate)
```bash
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M -pass 1 -an -f null /dev/null
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M -pass 2 -c:a aac output.mp4
```

### Combine audio + video from separate files
```bash
ffmpeg -i video.mp4 -i audio.aac -map 0:v -map 1:a -c copy output.mp4
```

### Split streams to separate files
```bash
ffmpeg -i input.mkv -map 0:v -c copy video.mp4 -map 0:a:0 -c copy audio.m4a
```

### Screen/device capture (Linux)
```bash
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :0.0 \
  -f pulse -i default -c:v libx264 -preset ultrafast output.mkv
```

---

## Hardware Acceleration

Read `references/hardware-accel.md` for detailed HW acceleration patterns.

**Quick picks:**
- NVIDIA: `-hwaccel cuda -c:v h264_nvenc`
- Intel: `-hwaccel qsv -c:v h264_qsv`
- Apple: `-hwaccel videotoolbox -c:v h264_videotoolbox`
- Linux/VAAPI: `-hwaccel vaapi -c:v h264_vaapi`

---

## Complex Filtergraphs (`-filter_complex`)

Use when you need multiple inputs/outputs or cross-stream operations.

```bash
# Side-by-side (hstack)
ffmpeg -i left.mp4 -i right.mp4 \
  -filter_complex "[0:v][1:v]hstack[out]" \
  -map "[out]" -map 0:a output.mp4

# Picture-in-picture overlay
ffmpeg -i main.mp4 -i overlay.mp4 \
  -filter_complex "[1:v]scale=320:180[pip];[0:v][pip]overlay=W-w-10:H-h-10[out]" \
  -map "[out]" -map 0:a output.mp4

# Mix two audio streams
ffmpeg -i input1.mp4 -i input2.mp4 \
  -filter_complex "[0:a][1:a]amix=inputs=2[aout]" \
  -map 0:v -map "[aout]" output.mp4
```

**Rules:**
- Labeled outputs (`[outv]`) must be mapped exactly once.
- Unlabeled outputs go to the first output file automatically.

---

## Stream Specifiers Cheat Sheet

| Specifier | Meaning |
|-----------|---------|
| `0:v` | All video streams from input 0 |
| `0:a:1` | Second audio stream from input 0 |
| `0:s` | All subtitle streams from input 0 |
| `0:2` | Stream index 2 from input 0 |
| `0:m:language:eng` | Stream with metadata `language=eng` |

---

## Debugging & Diagnostics

```bash
# Inspect input file
ffprobe -v quiet -print_format json -show_streams input.mp4

# Show progress to stdout
ffmpeg -progress pipe:1 -i input.mp4 output.mp4

# Verbose logging
ffmpeg -loglevel debug -i input.mp4 output.mp4

# Benchmark encoding
ffmpeg -benchmark -i input.mp4 output.mp4
```

---

## Common Gotchas

| Issue | Cause | Fix |
|-------|-------|-----|
| `moov atom not found` | MP4 not faststart | Add `-movflags +faststart` |
| Audio/video out of sync | Timestamp issues | Try `-async 1` or `-vsync cfr` |
| Green/corrupted frames | Wrong pixel format | Add `-pix_fmt yuv420p` |
| Subtitles not appearing | Wrong stream type | Check with `ffprobe`, use correct `-map` |
| Output file already exists | Default behavior | Use `-y` to overwrite, `-n` to skip |
| Seek inaccurate | Output-side seek | Use `-ss` before `-i` for speed, after for accuracy |
| No audio in output | Wrong default stream selection | Use explicit `-map` |
| H.265 not supported in QuickTime | Container/codec compat | Use `-tag:v hvc1` for Apple compatibility |

---

## Reference Files

- `references/hardware-accel.md` — Deep dive: NVENC, QSV, VAAPI, VideoToolbox patterns
- `references/filtergraph-patterns.md` — Advanced filter chain recipes

Load a reference file when the user's task requires depth beyond what's in this file.

# FFmpeg Advanced Filtergraph Patterns

## Simple vs Complex Filtergraphs

| Type | Option | When to use |
|------|--------|-------------|
| Simple | `-vf` / `-af` | Single input → single output, same type |
| Complex | `-filter_complex` | Multi-input, multi-output, or cross-type |

---

## Video Filter Chains

### Resize → Deinterlace → Pad
```bash
ffmpeg -i input.mp4 \
  -vf "yadif=mode=1,scale=1920:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

### Add letterbox/pillarbox (pad to 16:9)
```bash
ffmpeg -i input.mp4 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black" \
  output.mp4
```

### Crop center (portrait → square)
```bash
ffmpeg -i input.mp4 -vf "crop=ih:ih" output.mp4
```

### Speed up / slow down video
```bash
# 2x speed (drop audio or adjust separately)
ffmpeg -i input.mp4 -vf "setpts=0.5*PTS" -af "atempo=2.0" output.mp4

# 0.5x speed (slow motion)
ffmpeg -i input.mp4 -vf "setpts=2.0*PTS" -af "atempo=0.5" output.mp4
```

### Add text overlay (drawtext)
```bash
ffmpeg -i input.mp4 \
  -vf "drawtext=text='Hello World':fontcolor=white:fontsize=48:x=10:y=10" \
  output.mp4

# With timestamp
ffmpeg -i input.mp4 \
  -vf "drawtext=text='%{pts\:hms}':fontcolor=white:fontsize=36:x=10:y=10:box=1:boxcolor=black@0.5" \
  output.mp4
```

### Fade in/out
```bash
ffmpeg -i input.mp4 \
  -vf "fade=in:0:30,fade=out:st=270:d=30" \
  output.mp4
```

### Scene change detection
```bash
ffmpeg -i input.mp4 \
  -vf "select='gt(scene,0.4)',metadata=print:file=scenes.txt" \
  -vsync vfr thumbnails_%04d.jpg
```

---

## Audio Filter Chains

### Normalize loudness (EBU R128)
```bash
# Two-pass loudness normalization
# Pass 1: analyze
ffmpeg -i input.mp4 -af loudnorm=print_format=json -f null /dev/null 2>&1 | tail -12

# Pass 2: apply measured values
ffmpeg -i input.mp4 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-20:measured_LRA=7:measured_TP=-2:measured_thresh=-30:offset=0.5:linear=true" \
  output.mp4
```

### Remove silence
```bash
ffmpeg -i input.mp4 \
  -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-50dB" \
  output.mp4
```

### Stereo to mono
```bash
ffmpeg -i input.mp4 -af "pan=mono|c0=0.5*c0+0.5*c1" output.mp4
```

### Channel manipulation
```bash
# Swap L/R channels
ffmpeg -i input.mp4 -af "channelmap=1|0" output.mp4

# Isolate left channel
ffmpeg -i input.mp4 -af "pan=mono|c0=c0" output.mp4
```

---

## Complex Filtergraph Patterns

### Horizontal stack (side-by-side)
```bash
ffmpeg -i left.mp4 -i right.mp4 \
  -filter_complex "[0:v][1:v]hstack=inputs=2[out]" \
  -map "[out]" -map 0:a output.mp4
```

### Vertical stack (top/bottom)
```bash
ffmpeg -i top.mp4 -i bottom.mp4 \
  -filter_complex "[0:v][1:v]vstack=inputs=2[out]" \
  -map "[out]" -map 0:a output.mp4
```

### 2x2 grid
```bash
ffmpeg -i v0.mp4 -i v1.mp4 -i v2.mp4 -i v3.mp4 \
  -filter_complex "
    [0:v][1:v]hstack[top];
    [2:v][3:v]hstack[bot];
    [top][bot]vstack[out]
  " \
  -map "[out]" output.mp4
```

### Picture-in-picture
```bash
ffmpeg -i main.mp4 -i pip.mp4 \
  -filter_complex "
    [1:v]scale=320:180[small];
    [0:v][small]overlay=W-w-10:H-h-10[out]
  " \
  -map "[out]" -map 0:a output.mp4
```

### Animated PiP (slide in from right)
```bash
ffmpeg -i main.mp4 -i pip.mp4 \
  -filter_complex "
    [1:v]scale=320:180[small];
    [0:v][small]overlay=x='if(lt(t,1),W,W-(t-1)*(W-10)/1)':y=10[out]
  " \
  -map "[out]" -map 0:a output.mp4
```

### Mix audio from two inputs
```bash
ffmpeg -i video.mp4 -i music.mp3 \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.3[aout]" \
  -map 0:v -map "[aout]" -c:v copy output.mp4
```

### Concat videos (same codec/resolution)
```bash
# Create concat list file
printf "file 'part1.mp4'\nfile 'part2.mp4'\nfile 'part3.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

### Concat with re-encode (different formats OK)
```bash
ffmpeg -i part1.mp4 -i part2.mp4 -i part3.mp4 \
  -filter_complex "
    [0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]
  " \
  -map "[outv]" -map "[outa]" output.mp4
```

### Chroma key (green screen)
```bash
ffmpeg -i foreground.mp4 -i background.mp4 \
  -filter_complex "
    [0:v]chromakey=0x00b140:0.1:0.2[fg];
    [1:v][fg]overlay[out]
  " \
  -map "[out]" output.mp4
```

### Tile thumbnails (mosaic)
```bash
ffmpeg -i input.mp4 \
  -vf "fps=1/10,scale=320:180,tile=5x5" \
  -frames:v 1 mosaic.jpg
```

### Apply different filter to different time ranges
```bash
ffmpeg -i input.mp4 \
  -vf "
    select='between(t,10,20)',
    setpts=PTS-STARTPTS,
    boxblur=10:1
  " output.mp4
```

---

## Loopback Decoder Pattern

Compare original vs encoded quality side by side:
```bash
ffmpeg -i input.mp4 \
  -map 0:v -c:v libx264 -crf 45 -f null - \
  -threads 3 -dec 0:0 \
  -filter_complex '[0:v][dec:0]hstack[stack]' \
  -map '[stack]' -c:v ffv1 comparison.mkv
```

---

## Subtitle Handling

### Burn subtitles from SRT file
```bash
ffmpeg -i input.mp4 -vf "subtitles=subs.srt" output.mp4
```

### Burn subtitles from embedded stream (MKV)
```bash
# Extract subtitles first
ffmpeg -i input.mkv -map 0:s:0 subs.srt
# Then burn in
ffmpeg -i input.mkv -vf "subtitles=subs.srt" -map 0:v -map 0:a output.mp4
```

### Copy subtitles to output
```bash
ffmpeg -i input.mkv -map 0 -c copy -c:s mov_text output.mp4
```

### Add SRT as embedded subtitle track
```bash
ffmpeg -i input.mp4 -i subs.srt \
  -map 0 -map 1 \
  -c copy -c:s mov_text \
  output.mp4
```

---

## Streaming & Live

### Stream to RTMP (e.g., YouTube/Twitch)
```bash
ffmpeg -re -i input.mp4 \
  -c:v libx264 -preset veryfast -b:v 3000k -maxrate 3000k -bufsize 6000k \
  -pix_fmt yuv420p -g 60 \
  -c:a aac -b:a 128k -ar 44100 \
  -f flv rtmp://a.rtmp.youtube.com/live2/STREAM_KEY
```

### HLS output (for CDN/adaptive streaming)
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -crf 23 \
  -c:a aac -b:a 128k \
  -hls_time 6 -hls_list_size 0 \
  -f hls output.m3u8
```

### Multi-bitrate HLS (adaptive)
```bash
ffmpeg -i input.mp4 \
  -filter_complex "
    [0:v]split=3[v1][v2][v3];
    [v1]scale=1920:1080[v1out];
    [v2]scale=1280:720[v2out];
    [v3]scale=640:360[v3out]
  " \
  -map "[v1out]" -c:v:0 libx264 -b:v:0 5000k \
  -map "[v2out]" -c:v:1 libx264 -b:v:1 2500k \
  -map "[v3out]" -c:v:2 libx264 -b:v:2 800k \
  -map 0:a -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_list_size 0 \
  -master_pl_name master.m3u8 \
  -hls_segment_filename "stream_%v_%03d.ts" \
  "stream_%v.m3u8"
```

---

## Performance Tips

1. **Use `-preset`**: `ultrafast` for speed, `slow`/`veryslow` for quality at same bitrate.
2. **Thread count**: `-threads 0` lets FFmpeg auto-detect (usually best).
3. **Streamcopy when possible**: `-c copy` is always faster than transcoding.
4. **Input seeking**: Place `-ss` before `-i` for fast seek (less accurate but much faster).
5. **Pipe output**: Use `-f null /dev/null` for analysis without writing files.
6. **Avoid unnecessary pixel format conversions**: Match input/output pixel formats.
7. **`-tune`**: Use `-tune zerolatency` for streaming, `-tune film` for movies.

# FFmpeg Hardware Acceleration Reference

## Overview

Hardware acceleration offloads encode/decode to GPU or dedicated media engines.
Always check availability first:
```bash
ffmpeg -hwaccels          # list supported HW accel methods
ffmpeg -encoders | grep nvenc   # check NVIDIA encoders
ffmpeg -encoders | grep qsv     # check Intel QSV encoders
ffmpeg -encoders | grep vaapi   # check VAAPI encoders
```

---

## NVIDIA (NVENC / CUDA)

### Decode + Encode on GPU (zero-copy)
```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -c:a copy output.mp4
```

### Decode on GPU, filter on CPU, encode on GPU
```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 \
  -vf "hwdownload,format=nv12,scale=1280:720,hwupload_cuda" \
  -c:v h264_nvenc -preset p4 output.mp4
```

### NVENC Quality Presets
| Preset | Speed | Quality |
|--------|-------|---------|
| `p1` | Fastest | Lowest |
| `p4` | Balanced | Good |
| `p7` | Slowest | Best |

### NVENC Rate Control
```bash
-cq 23        # Constant Quality (like CRF for software)
-b:v 4M       # Target bitrate
-rc vbr -cq 23 -maxrate 8M -bufsize 16M  # VBR with quality target
```

### HEVC on NVIDIA
```bash
ffmpeg -hwaccel cuda -i input.mp4 -c:v hevc_nvenc -preset p4 -cq 28 output.mp4
```

### AV1 on NVIDIA (RTX 4000+)
```bash
ffmpeg -hwaccel cuda -i input.mp4 -c:v av1_nvenc -preset p4 output.mp4
```

---

## Intel QuickSync (QSV)

### Basic H.264 encode
```bash
ffmpeg -hwaccel qsv -c:v h264_qsv -i input.mp4 \
  -c:v h264_qsv -global_quality 23 output.mp4
```

### Full QSV pipeline (decode + encode)
```bash
ffmpeg -init_hw_device qsv=hw -filter_hw_device hw \
  -hwaccel qsv -hwaccel_output_format qsv \
  -i input.mp4 \
  -c:v h264_qsv -global_quality 23 \
  -c:a copy output.mp4
```

### QSV with scaling filter
```bash
ffmpeg -init_hw_device qsv=qsv:hw \
  -hwaccel qsv -hwaccel_output_format qsv \
  -i input.mp4 \
  -vf "vpp_qsv=w=1280:h=720" \
  -c:v h264_qsv -global_quality 23 output.mp4
```

---

## VAAPI (Linux — Intel/AMD)

### Discover device
```bash
ls /dev/dri/render*
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD128 -v verbose -f lavfi -i nullsrc -t 1 -f null -
```

### Basic encode
```bash
ffmpeg -vaapi_device /dev/dri/renderD128 \
  -i input.mp4 \
  -vf 'format=nv12,hwupload' \
  -c:v h264_vaapi -qp 23 output.mp4
```

### Full HW pipeline (decode + scale + encode)
```bash
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD128 \
  -hwaccel vaapi -hwaccel_output_format vaapi \
  -hwaccel_device /dev/dri/renderD128 \
  -i input.mp4 \
  -vf 'scale_vaapi=w=1280:h=720' \
  -c:v h264_vaapi -qp 23 output.mp4
```

---

## Apple VideoToolbox (macOS)

### H.264 encode
```bash
ffmpeg -i input.mp4 -c:v h264_videotoolbox -b:v 4M output.mp4
```

### HEVC encode (with Apple Silicon)
```bash
ffmpeg -i input.mp4 -c:v hevc_videotoolbox -b:v 3M -tag:v hvc1 output.mp4
```
> `-tag:v hvc1` required for QuickTime/iOS compatibility.

### ProRes (professional workflow)
```bash
ffmpeg -i input.mp4 -c:v prores_ks -profile:v 3 -c:a copy output.mov
# Profiles: 0=Proxy, 1=LT, 2=Standard, 3=HQ, 4=4444, 5=4444XQ
```

---

## Common HW Acceleration Patterns

### Check if HW decode worked (look for this in verbose output)
```
Using hw acceleration type cuda
```

### Fallback to software if HW fails
```bash
# Try HW first, fall back gracefully
ffmpeg -hwaccel auto -i input.mp4 -c:v libx264 -crf 23 output.mp4
```

### Filters with HW frames
When using HW acceleration, filters generally need frames in system memory.
Insert `hwdownload` + `format=` to pull frames to CPU, then `hwupload` to push back:

```bash
# CUDA example
-vf "hwdownload,format=nv12,scale=1280:720,hwupload_cuda"

# VAAPI example  
-vf "hwdownload,format=nv12,scale=640:360,hwupload,format=vaapi"
```

---

## Troubleshooting HW Accel

| Problem | Fix |
|---------|-----|
| `No NVENC capable devices found` | Check driver, use `nvidia-smi` |
| `Device creation failed` | Verify `/dev/dri/renderD128` exists |
| `Conversion failed` | Frames stuck in HW format, add `hwdownload` before SW filter |
| `Initialization failed` | Missing HW codec support in FFmpeg build, check `-encoders` |
| VideoToolbox `Invalid argument` | Add `-allow_sw 1` to allow SW fallback |
