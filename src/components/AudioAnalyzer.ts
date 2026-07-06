export async function analyzeAudioBeats(onProgress: (msg: string) => void): Promise<number[]> {
  try {
    onProgress("Téléchargement du fichier tanzschein.mp3...");
    const response = await fetch('/tanzschein.mp3');
    if (!response.ok) throw new Error("Fichier MP3 introuvable dans le dossier public.");
    
    const arrayBuffer = await response.arrayBuffer();
    onProgress("Décodage de l'audio MP3 (PCM)...");
    
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    onProgress("Analyse spectrale des transitoires (Drums/Hits)...");
    const channelData = audioBuffer.getChannelData(0); // Canal gauche
    const sampleRate = audioBuffer.sampleRate;
    
    const peaks: number[] = [];
    const windowSize = Math.floor(sampleRate * 0.02); // Fenêtre de 20ms
    const stepSize = Math.floor(sampleRate * 0.01); // Pas de 10ms
    
    let lastPeakTime = -1;
    // Seuil de détection des transitoires d'énergie
    const threshold = 0.38; 
    
    for (let i = 0; i < channelData.length - windowSize; i += stepSize) {
      const time = i / sampleRate;
      if (time > 45.0) break; // Limiter aux 45 premières secondes
      
      // Calculer l'amplitude maximale absolue dans la fenêtre
      let maxVal = 0;
      for (let j = 0; j < windowSize; j++) {
        const val = Math.abs(channelData[i + j]);
        if (val > maxVal) maxVal = val;
      }
      
      // Si la valeur dépasse le seuil et qu'on a un écart de 220ms minimum (rythme à 130 BPM)
      if (maxVal > threshold && (time - lastPeakTime) > 0.22) {
        peaks.push(parseFloat(time.toFixed(2)));
        lastPeakTime = time;
      }
    }
    
    onProgress(`Analyse terminée ! ${peaks.length} impacts rythmiques détectés.`);
    console.log("=== TIMESTAMP DES IMPACTS RYTHMIQUES (45s) ===");
    console.log(JSON.stringify(peaks));
    return peaks;
  } catch (e) {
    onProgress(`Erreur d'analyse : ${(e as Error).message}`);
    console.error("Audio analysis failed:", e);
    return [];
  }
}
