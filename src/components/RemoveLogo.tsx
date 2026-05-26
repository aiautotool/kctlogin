import { type ClipboardEvent as ReactClipboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Download, Film, Image, ImagePlus, Loader2, RotateCcw, Sparkles, UploadCloud } from 'lucide-react';

const API_BASE = '/api';
const MAX_IMAGE_SIZE = 40 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

type ToolMode = 'image' | 'video';

interface SelectedImage {
  file: File;
  dataUrl: string;
}

interface SelectedVideo {
  file: File;
  objectUrl: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
    reader.readAsDataURL(file);
  });
}

interface RemoveLogoProps {
  compact?: boolean;
}

export function RemoveLogo({ compact = false }: RemoveLogoProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<ToolMode>('image');
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [resultDataUrl, setResultDataUrl] = useState('');
  const [resultVideoUrl, setResultVideoUrl] = useState('');
  const [videoZoom, setVideoZoom] = useState(1.12);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const outputName = useMemo(() => {
    if (mode === 'video') {
      if (!selectedVideo) return 'veo-logo-removed.mp4';
      const baseName = selectedVideo.file.name.replace(/\.[^.]+$/, '') || 'video';
      return `${baseName}-veo-logo-removed.mp4`;
    }
    if (!selectedImage) return 'gemini-logo-removed.png';
    const baseName = selectedImage.file.name.replace(/\.[^.]+$/, '') || 'image';
    return `${baseName}-removed.png`;
  }, [mode, selectedImage, selectedVideo]);

  const processImage = async (imageDataUrl: string) => {
    setIsProcessing(true);
    setError('');
    try {
      const response = await axios.post(`${API_BASE}/remove-gemini-logo`, {
        imageDataUrl,
      });
      setResultDataUrl(response.data.imageDataUrl);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || requestError.message || 'Không thể remove logo Gemini.');
    } finally {
      setIsProcessing(false);
    }
  };

  const pickFile = async (file?: File) => {
    setError('');
    if (!file) return;

    if (file.type.startsWith('video/')) {
      await pickVideoFile(file);
      return;
    }

    setResultDataUrl('');
    if (!file.type.startsWith('image/')) return setError('Vui lòng chọn file ảnh hoặc video.');
    if (file.size > MAX_IMAGE_SIZE) return setError('Ảnh quá lớn. Vui lòng dùng ảnh dưới 40MB.');

    try {
      setMode('image');
      const dataUrl = await readFileAsDataUrl(file);
      setSelectedImage({ file, dataUrl });
      await processImage(dataUrl);
    } catch (readError: any) {
      setError(readError.message || 'Không đọc được file ảnh.');
    }
  };

  const processVideo = async (file = selectedVideo?.file) => {
    if (!file) {
      setError('Upload video trước khi remove logo VEO.');
      return;
    }

    setIsProcessing(true);
    setError('');
    setResultVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('zoom', String(videoZoom));
      const response = await axios.post(`${API_BASE}/remove-veo-logo`, formData, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResultVideoUrl(URL.createObjectURL(response.data));
    } catch (requestError: any) {
      const errorBlob = requestError.response?.data;
      let message = requestError.message || 'Không thể remove logo VEO.';
      if (errorBlob instanceof Blob) {
        try {
          const parsed = JSON.parse(await errorBlob.text());
          message = parsed.error || message;
        } catch {
          message = 'Không thể remove logo VEO.';
        }
      }
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const pickVideoFile = async (file: File) => {
    setMode('video');
    setError('');
    setResultVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    if (file.size > MAX_VIDEO_SIZE) return setError('Video quá lớn. Vui lòng dùng video dưới 500MB.');

    const objectUrl = URL.createObjectURL(file);
    setSelectedVideo((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return { file, objectUrl };
    });
    await processVideo(file);
  };

  const pickImageFromClipboard = (event: ReactClipboardEvent<HTMLElement> | globalThis.ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items || []);
    const mediaItem = items.find((item) => item.type.startsWith('image/') || item.type.startsWith('video/'));
    const file = mediaItem?.getAsFile();
    if (!file) return;

    event.preventDefault();
    pickFile(file);
  };

  useEffect(() => {
    const handlePaste = (event: globalThis.ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      pickImageFromClipboard(event);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const removeLogo = async () => {
    if (mode === 'video') return processVideo();
    if (!selectedImage) return setError('Upload ảnh trước khi remove logo.');
    await processImage(selectedImage.dataUrl);
  };

  const downloadResult = () => {
    const href = mode === 'video' ? resultVideoUrl : resultDataUrl;
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const reset = () => {
    setSelectedImage(null);
    setSelectedVideo((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
    setResultDataUrl('');
    setResultVideoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectedFile = mode === 'video' ? selectedVideo?.file : selectedImage?.file;
  const hasResult = mode === 'video' ? !!resultVideoUrl : !!resultDataUrl;

  return (
    <div className={compact ? 'h-screen overflow-y-auto p-4 space-y-4 custom-scrollbar' : 'space-y-6'} onPaste={pickImageFromClipboard}>
      <div className={compact ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6'}>
        <section className={`glass-effect ${compact ? 'rounded-xl p-4 space-y-4' : 'rounded-2xl p-5 space-y-5'}`}>
          <div>
            <h3 className={compact ? 'text-base font-semibold text-white' : 'text-lg font-semibold text-white'}>Remove logo</h3>
            <p className={compact ? 'mt-1 text-xs text-gray-400' : 'mt-1 text-sm text-gray-400'}>{mode === 'video' ? 'Upload video VEO, tự zoom/crop và tải MP4.' : 'Dán, upload, xử lý và tải file PNG sạch logo.'}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => setMode('image')}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'image' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'}`}
            >
              <Image className="h-4 w-4" />
              Gemini ảnh
            </button>
            <button
              type="button"
              onClick={() => setMode('video')}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'video' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'}`}
            >
              <Film className="h-4 w-4" />
              VEO video
            </button>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              pickFile(event.dataTransfer.files[0]);
            }}
            className={`w-full ${compact ? 'min-h-[136px] rounded-xl p-4' : 'min-h-[220px] rounded-2xl p-6'} border border-dashed text-left transition ${
              isDragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-white/15 bg-white/[0.025] hover:border-blue-400/60 hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className={`${compact ? 'rounded-xl p-3' : 'rounded-2xl p-4'} bg-blue-500/10 text-blue-300`}>
                <UploadCloud className={compact ? 'h-6 w-6' : 'h-8 w-8'} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{mode === 'video' ? 'Kéo thả video vào đây hoặc bấm để chọn' : 'Kéo thả ảnh vào đây hoặc bấm để chọn'}</p>
                <p className="mt-1 text-xs text-gray-500">{mode === 'video' ? 'MP4, MOV, M4V, WebM · tối đa 500MB' : 'PNG, JPG, WebP · tối đa 40MB · hỗ trợ Cmd/Ctrl + V'}</p>
              </div>
            </div>
          </button>

          <input
            ref={inputRef}
            type="file"
            accept={mode === 'video' ? 'video/mp4,video/quicktime,video/webm,video/x-m4v,.m4v,.mov,.mp4,.webm' : 'image/png,image/jpeg,image/webp'}
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />

          {mode === 'video' && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-300">Zoom/Crop VEO</p>
                  <p className="text-[11px] text-gray-500">Mặc định 1.12x giống repo mẫu</p>
                </div>
                <input
                  type="number"
                  min="1"
                  max="1.35"
                  step="0.01"
                  value={videoZoom}
                  onChange={(event) => setVideoZoom(Number(event.target.value) || 1.12)}
                  className="w-20 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            </div>
          )}

          {selectedFile && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
                  {mode === 'video' ? <Film className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">{formatBytes(selectedFile.size)}</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={removeLogo}
              disabled={!selectedFile || isProcessing}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Chạy lại
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-white/[0.06] hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
              Làm lại
            </button>
          </div>

          <button
            type="button"
            onClick={downloadResult}
            disabled={!hasResult}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {mode === 'video' ? 'Tải video đã remove' : 'Tải ảnh đã remove'}
          </button>
        </section>

        <section className={compact ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
          {mode === 'video' ? (
            <>
              {!compact && <VideoPanel title="Video gốc" video={selectedVideo?.objectUrl || ''} emptyText="Chưa chọn video" />}
              <VideoPanel title={compact ? 'Preview' : 'Video sau khi remove'} video={resultVideoUrl || selectedVideo?.objectUrl || ''} emptyText={isProcessing ? 'Đang xử lý video...' : 'Upload video để bắt đầu'} compact={compact} />
            </>
          ) : (
            <>
              {!compact && <PreviewPanel title="Ảnh gốc" image={selectedImage?.dataUrl || ''} emptyText="Chưa chọn ảnh" />}
              <PreviewPanel
                title={compact ? 'Preview' : 'Ảnh sau khi remove'}
                image={resultDataUrl || selectedImage?.dataUrl || ''}
                emptyText={isProcessing ? 'Đang xử lý...' : 'Dán hoặc upload ảnh để bắt đầu'}
                compact={compact}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function VideoPanel({ title, video, emptyText, compact = false }: { title: string; video: string; emptyText: string; compact?: boolean }) {
  return (
    <div className={`glass-effect ${compact ? 'rounded-xl min-h-[260px]' : 'rounded-2xl min-h-[520px]'} overflow-hidden flex flex-col`}>
      <div className="border-b border-white/5 px-5 py-4">
        <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
      </div>
      <div className="flex flex-1 items-center justify-center bg-black/20 p-4">
        {video ? (
          <video src={video} controls className={`${compact ? 'max-h-[320px]' : 'max-h-[70vh]'} w-full rounded-xl bg-black object-contain`} />
        ) : (
          <div className="text-sm text-gray-500">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({ title, image, emptyText, compact = false }: { title: string; image: string; emptyText: string; compact?: boolean }) {
  return (
    <div className={`glass-effect ${compact ? 'rounded-xl min-h-[260px]' : 'rounded-2xl min-h-[520px]'} overflow-hidden flex flex-col`}>
      <div className="border-b border-white/5 px-5 py-4">
        <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
      </div>
      <div className="flex flex-1 items-center justify-center bg-black/20 p-4">
        {image ? (
          <img src={image} alt={title} className={`${compact ? 'max-h-[320px]' : 'max-h-[70vh]'} w-full object-contain rounded-xl`} />
        ) : (
          <div className="text-sm text-gray-500">{emptyText}</div>
        )}
      </div>
    </div>
  );
}
