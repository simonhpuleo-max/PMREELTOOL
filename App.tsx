import React, { useState, useRef } from 'react';
import { NewsItem, Script } from './types';
import {
  fetchRealEstateNews,
  generateReelScript,
  generateScriptFromCustomContent,
  editReelScript,
  generateSpeech,
  generateScriptFromVideo,
} from './services/geminiService';
import { exportScriptToDocx } from './utils/wordExporter';
import { createWavBlob, decode } from './utils/audioUtils';
import LoadingSpinner from './components/LoadingSpinner';
import { DownloadIcon, EditIcon, PlayIcon, SparklesIcon, StopIcon, ArrowUpTrayIcon } from './components/icons';
import { Logo } from './components/Logo';
// FIX: Import the 'translations' object for strong typing in the handleError function.
import { Language, t, translations } from './utils/translations';

type AppState = 'idle' | 'fetchingNews' | 'newsReady' | 'generatingScript' | 'scriptReady';
type ActiveTab = 'news' | 'text' | 'video';

const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve({ base64, mimeType: file.type });
        };
        reader.onerror = (error) => reject(error);
    });
};

function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [activeTab, setActiveTab] = useState<ActiveTab>('news');
  const [language, setLanguage] = useState<Language>('es');
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [customContent, setCustomContent] = useState<string>('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editCommand, setEditCommand] = useState<string>('');
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // FIX: Use the imported 'translations' object for the type of 'defaultKey'.
  // This ensures that only valid translation keys can be passed to the function.
  const handleError = (e: any, defaultKey: keyof typeof translations) => {
    setError(e.message || t(defaultKey, language));
  }

  const handleFetchNews = async () => {
    setAppState('fetchingNews');
    setError(null);
    setNewsItems([]);
    try {
      const items = await fetchRealEstateNews(language);
      setNewsItems(items);
      setAppState('newsReady');
    } catch (e: any) {
      handleError(e, 'unknownError');
      setAppState('idle');
    }
  };

  const handleSelectNews = async (item: NewsItem) => {
    setAppState('generatingScript');
    setSelectedNews(item);
    setError(null);
    setScript(null);
    try {
      const generatedScript = await generateReelScript(item, language);
      if (generatedScript) {
        setScript(generatedScript);
        setAppState('scriptReady');
      } else {
        throw new Error(t('emptyScriptError', language));
      }
    } catch (e: any) {
      handleError(e, 'unknownError');
      setAppState('newsReady');
    }
  };
  
  const handleGenerateFromCustomContent = async () => {
    if (!customContent.trim()) {
      setError(t('emptyContentError', language));
      return;
    }
    setAppState('generatingScript');
    setSelectedNews({ headline: t('customTextButton', language), date: new Date().toLocaleDateString(), source: "User", summary: customContent });
    setError(null);
    setScript(null);
    try {
      const generatedScript = await generateScriptFromCustomContent(customContent, language);
      if (generatedScript) {
        setScript(generatedScript);
        setAppState('scriptReady');
      } else {
        throw new Error(t('emptyScriptError', language));
      }
    } catch (e: any) {
      handleError(e, 'unknownError');
      setAppState('idle');
    }
  };

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        if (!file.type.startsWith('video/')) {
            setError(t('invalidVideoError', language));
            e.target.value = '';
            return;
        }
        setVideoFile(file);
        setError(null);
    }
  };

  const handleGenerateFromVideo = async () => {
    if (!videoFile) {
        setError(t('emptyVideoError', language));
        return;
    }
    setAppState('generatingScript');
    setSelectedNews({ headline: `${videoFile.name}`, date: new Date().toLocaleDateString(), source: "User Video", summary: "Content extracted from video." });
    setError(null);
    setScript(null);
    try {
        const { base64, mimeType } = await fileToBase64(videoFile);
        const generatedScript = await generateScriptFromVideo(base64, mimeType, language);
        if (generatedScript) {
            setScript(generatedScript);
            setAppState('scriptReady');
        } else {
            throw new Error(t('emptyVideoScriptError', language));
        }
    } catch (e: any) {
        handleError(e, 'unknownError');
        setAppState('idle');
    }
  };
  
  const handleEditScript = async () => {
    if (!script || !selectedNews || !editCommand.trim()) return;
    setIsEditing(false);
    setAppState('generatingScript');
    setError(null);
    try {
        const editedScript = await editReelScript(selectedNews, script, editCommand, language);
        if (editedScript) {
            setScript(editedScript);
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
            }
            setIsPlayingAudio(false);
        } else {
            throw new Error(t('editScriptError', language));
        }
    } catch (e: any) {
        handleError(e, 'unknownError');
    } finally {
        setAppState('scriptReady');
        setEditCommand('');
    }
  };

  const handleGenerateAudio = async () => {
    if (!script?.cleanAudioText) return;
    setIsGeneratingAudio(true);
    setError(null);
    try {
        const audioB64 = await generateSpeech(script.cleanAudioText, language);
        if (audioB64) {
            if (audioUrl) URL.revokeObjectURL(audioUrl);
            const pcmData = decode(audioB64);
            const wavBlob = createWavBlob(pcmData, 24000, 1);
            const newAudioUrl = URL.createObjectURL(wavBlob);
            setAudioUrl(newAudioUrl);
            audioRef.current = new Audio(newAudioUrl);
            audioRef.current.onended = () => setIsPlayingAudio(false);
            handlePlayAudio();
        }
    } catch (e: any) {
        handleError(e, 'unknownError');
    } finally {
        setIsGeneratingAudio(false);
    }
  };

  const handlePlayAudio = () => {
    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play().catch(e => {
            console.error("Audio play failed:", e);
            setError(t('audioPlayError', language));
            setIsPlayingAudio(false);
        });
        setIsPlayingAudio(true);
      }
    }
  };

  const handleDownload = () => {
    if (script && selectedNews) {
      exportScriptToDocx(script, selectedNews, language);
    }
  };
  
  const handleBack = () => {
    setScript(null);
    setSelectedNews(null);
    setError(null);
    setCustomContent('');
    setIsEditing(false);
    setEditCommand('');
    setVideoFile(null);
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
    }
    if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
    }
    setIsPlayingAudio(false);
    setAppState(newsItems.length > 0 ? 'newsReady' : 'idle');
    setActiveTab('news');
  };

  const TabButton: React.FC<{tabId: ActiveTab; children: React.ReactNode}> = ({tabId, children}) => (
    <button onClick={() => setActiveTab(tabId)} className={`px-3 py-2 font-semibold transition-colors duration-200 text-sm md:text-base md:px-4 ${activeTab === tabId ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-primary'}`} aria-selected={activeTab === tabId} role="tab">
        {children}
    </button>
  );

  const LangButton: React.FC<{langId: Language}> = ({langId}) => (
    <button onClick={() => setLanguage(langId)} className={`px-2 py-1 text-xs font-bold rounded-md transition-colors ${language === langId ? 'bg-primary text-white' : 'bg-complementary text-text hover:bg-primary/20'}`}>
        {langId.toUpperCase()}
    </button>
  );

  return (
    <div className="bg-background text-text min-h-screen font-sans">
      <div className="container mx-auto p-4 md:p-8 max-w-4xl">
        <header className="text-center mb-8 relative">
            <div className="absolute top-0 right-0 -mt-2 md:mt-0 flex gap-1 md:gap-2">
                <LangButton langId='es' />
                <LangButton langId='en' />
                <LangButton langId='pt' />
            </div>
            <Logo className="h-16 md:h-20 w-auto text-primary mx-auto" />
            <p className="text-gray-600 mt-2">{t('subtitle', language)}</p>
        </header>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
            <strong className="font-bold">{t('errorTitle', language)} </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {appState !== 'scriptReady' && (
          <div className="bg-white p-6 rounded-lg shadow-lg border border-complementary">
            <h2 className="text-2xl font-semibold mb-4 text-primary">{t('step1Title', language)}</h2>
            
            <div className="border-b border-complementary mb-4 flex justify-around" role="tablist">
                <TabButton tabId="news">{t('tabNews', language)}</TabButton>
                <TabButton tabId="text">{t('tabText', language)}</TabButton>
                <TabButton tabId="video">{t('tabVideo', language)}</TabButton>
            </div>
            
            <div className="pt-4">
                {activeTab === 'news' && (
                    <div role="tabpanel">
                        <p className="text-sm text-gray-600 mb-2">{t('newsDescription', language)}</p>
                        <button onClick={handleFetchNews} disabled={appState === 'fetchingNews'} className="w-full bg-primary hover:opacity-90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition duration-300 flex items-center justify-center text-lg">
                          {appState === 'fetchingNews' ? <LoadingSpinner className="text-white mr-3 -ml-1" /> : <SparklesIcon className="w-6 h-6 mr-2" />}
                          {t('newsButton', language)}
                        </button>
                        {appState === 'fetchingNews' && <p className="text-center text-gray-600 mt-4">{t('newsLoading', language)}</p>}
                    </div>
                )}
                 {activeTab === 'text' && (
                    <div role="tabpanel" className="flex flex-col">
                        <div className="relative w-full mb-3">
                            <textarea value={customContent} onChange={(e) => setCustomContent(e.target.value)} placeholder={t('customTextPlaceholder', language)} className="bg-complementary/50 text-text p-3 rounded-lg w-full flex-grow focus:ring-2 focus:ring-highlight focus:outline-none placeholder-gray-500 resize-none" rows={4} maxLength={700} />
                            <div className={`absolute bottom-3 right-3 text-xs pointer-events-none ${customContent.length >= 700 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                {customContent.length} / 700
                            </div>
                        </div>
                        <button onClick={handleGenerateFromCustomContent} disabled={appState === 'generatingScript' || !customContent.trim()} className="w-full bg-primary hover:opacity-90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition duration-300 flex items-center justify-center text-lg">
                          {appState === 'generatingScript' && selectedNews?.source === 'User' ? <LoadingSpinner className="text-white mr-3 -ml-1" /> : <SparklesIcon className="w-6 h-6 mr-2" />}
                          {t('customTextButton', language)}
                        </button>
                    </div>
                )}
                {activeTab === 'video' && (
                     <div role="tabpanel" className="flex flex-col">
                        <p className="text-sm text-gray-600 mb-2">{t('videoDescription', language)}</p>
                         <label htmlFor="video-upload" className="w-full bg-complementary/30 hover:bg-complementary/50 text-primary font-bold p-4 rounded-lg transition duration-300 flex flex-col items-center justify-center text-center cursor-pointer border-2 border-dashed border-complementary">
                            <ArrowUpTrayIcon className="w-8 h-8 mb-2 text-gray-500" />
                            <span className="text-gray-700">{videoFile ? `${t('videoFileSelected', language)} ${videoFile.name}` : t('videoSelect', language)}</span>
                            <span className="text-xs text-gray-500 mt-1">{t('videoDropzone', language)}</span>
                        </label>
                        <input id="video-upload" type="file" className="hidden" accept="video/*" onChange={handleVideoFileChange} />
                        <button onClick={handleGenerateFromVideo} disabled={appState === 'generatingScript' || !videoFile} className="mt-4 w-full bg-primary hover:opacity-90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition duration-300 flex items-center justify-center text-lg">
                          {appState === 'generatingScript' && selectedNews?.source === 'User Video' ? <LoadingSpinner className="text-white mr-3 -ml-1" /> : <SparklesIcon className="w-6 h-6 mr-2" />}
                          {t('videoButton', language)}
                        </button>
                    </div>
                )}
            </div>
          </div>
        )}
        
        {appState === 'newsReady' && newsItems.length > 0 && (
          <div className="mt-8 animate-fade-in">
            <h2 className="text-2xl font-semibold mb-4 text-primary">{t('step2Title', language)}</h2>
            <div className="space-y-4">
              {newsItems.map((item, index) => (
                <div key={index} className="bg-white p-4 rounded-lg cursor-pointer hover:bg-complementary/40 transition duration-200 border border-complementary" onClick={() => handleSelectNews(item)}>
                  <h3 className="font-bold text-lg text-primary">{item.headline}</h3>
                  <p className="text-sm text-gray-500">{item.source} - {item.date}</p>
                  <p className="mt-2 text-text">{item.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {(appState === 'generatingScript') && (
            <div className="text-center mt-8 flex flex-col items-center justify-center">
                <LoadingSpinner className="text-primary h-8 w-8" />
                <p className="mt-4 text-lg text-gray-600">
                    {selectedNews?.source === 'User Video' ? t('transcribingScript', language) : t('generatingScript', language)} "{selectedNews?.headline}"...
                </p>
            </div>
        )}

        {appState === 'scriptReady' && script && selectedNews && (
          <div className="bg-white p-6 rounded-lg shadow-lg mt-8 animate-fade-in border border-complementary">
            <button onClick={handleBack} className="text-highlight hover:opacity-80 mb-4 font-semibold">&larr; {t('backButton', language)}</button>
            <h2 className="text-3xl font-bold mb-2 text-primary">{script.suggestions.title}</h2>
            <p className="text-md text-gray-500 mb-6 break-words">{t('basedOn', language)} "{selectedNews.headline}"</p>
            
            <div className="flex flex-wrap gap-4 mb-6">
                 <button onClick={!isGeneratingAudio ? (audioRef.current ? handlePlayAudio : handleGenerateAudio) : undefined} disabled={isGeneratingAudio} className="flex items-center justify-center bg-highlight hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-highlight/50">
                    {isGeneratingAudio ? <LoadingSpinner className="text-white mr-3 -ml-1"/> : (isPlayingAudio ? <StopIcon className="w-5 h-5 mr-2" /> : <PlayIcon className="w-5 h-5 mr-2" />)}
                    {isGeneratingAudio ? t('generatingAudio', language) : (isPlayingAudio ? t('stopAudio', language) : t('listenButton', language))}
                </button>
                <button onClick={() => setIsEditing(!isEditing)} className="flex items-center justify-center bg-secondary hover:opacity-90 text-primary font-bold py-2 px-4 rounded-lg transition duration-300">
                    <EditIcon className="w-5 h-5 mr-2" /> {t('editButton', language)}
                </button>
                <button onClick={handleDownload} className="flex items-center justify-center bg-primary hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition duration-300">
                    <DownloadIcon className="w-5 h-5 mr-2" /> {t('downloadButton', language)}
                </button>
            </div>

            {isEditing && (
                <div className="my-4 p-4 bg-complementary/50 rounded-lg animate-fade-in">
                    <label className="font-semibold text-text mb-2 block">{t('editPanelTitle', language)}</label>
                    <textarea value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder={t('editPanelPlaceholder', language)} className="bg-white text-text p-3 rounded-lg w-full mb-3 focus:ring-2 focus:ring-highlight focus:outline-none placeholder-gray-500 border border-complementary/80" rows={3} />
                    <button onClick={handleEditScript} className="bg-secondary hover:opacity-90 text-primary font-bold py-2 px-4 rounded-lg transition duration-300">{t('regenerateButton', language)}</button>
                </div>
            )}
            
            <div className="grid md:grid-cols-5 gap-8 mt-6">
              <div className="md:col-span-3 space-y-6">
                  <div>
                    <h3 className="font-semibold text-xl text-primary border-b-2 border-complementary pb-2 mb-3">🎬 {t('detailedScriptTitle', language)}</h3>
                    <p className="font-bold text-text/80">{t('hookTitle', language)}</p>
                    <p className="mb-3 pl-4 text-text">{script.detailedScript.hook}</p>
                    <p className="font-bold text-text/80">{t('developmentTitle', language)}</p>
                    <p className="mb-3 pl-4 text-text">{script.detailedScript.development}</p>
                    <p className="font-bold text-text/80">{t('ctaTitle', language)}</p>
                    <p className="pl-4 text-text">{script.detailedScript.cta}</p>
                  </div>
                   <div>
                    <h3 className="font-semibold text-xl text-primary border-b-2 border-complementary pb-2 mb-3">🎙️ {t('audioTextTitle', language)}</h3>
                    <p className="italic text-gray-600 bg-complementary/40 p-3 rounded-lg">{script.cleanAudioText}</p>
                  </div>
              </div>

              <div className="md:col-span-2 bg-background p-4 rounded-lg space-y-4">
                  <h3 className="font-semibold text-xl text-primary border-b-2 border-complementary pb-2 mb-3">💡 {t('suggestionsTitle', language)}</h3>
                  <div>
                    <p className="font-bold text-text/80">{t('hashtagsTitle', language)}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                        {script.suggestions.hashtags.map((tag, i) => (
                            <span key={i} className="bg-primary/10 text-primary text-sm font-medium px-2.5 py-0.5 rounded-full">{tag}</span>
                        ))}
                    </div>
                  </div>
                  <div>
                    <p className="font-bold text-text/80">{t('thumbnailTitle', language)}</p>
                    <p className="text-gray-600">{script.suggestions.thumbnailIdea}</p>
                  </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;