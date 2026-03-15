import { GoogleGenAI, Type } from "@google/genai";
import { TestQuestion, UserProfile } from "../types";

// Vercelに登録した3つのキーを読み込む
const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1,
  import.meta.env.VITE_GEMINI_API_KEY_2,
  import.meta.env.VITE_GEMINI_API_KEY_3
].filter(Boolean);

// タイムアウトを防ぐための最速モデル
const MODEL_TEXT = 'gemini-1.5-flash-8b';

// APIキーを順番に試す仕組み
async function getAIResponse(callback: (ai: any) => Promise<any>) {
  let lastError;
  for (const key of API_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      return await callback(ai);
    } catch (error) {
      lastError = error;
      console.warn("APIキー制限のため、次を試します。");
      continue;
    }
  }
  throw lastError || new Error("All keys failed.");
}

export const createChatStream = async function* (
  history: any[],
  newMessage: string,
  imageDataUrl?: string,
  userProfile?: UserProfile
) {
  const systemInstruction = `あなたは日本トップクラスの予備校講師です。簡潔かつ論理的に回答してください。`;
  
  const result = await getAIResponse(async (ai) => {
    const chat = ai.chats.create({
      model: MODEL_TEXT,
      history: history,
      config: { systemInstruction }
    });

    let messageContent: any = newMessage;
    if (imageDataUrl) {
      const [header, base64Data] = imageDataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      messageContent = [
        { text: newMessage || "解説してください。" },
        { inlineData: { mimeType, data: base64Data } }
      ];
    }
    return await chat.sendMessageStream({ message: messageContent });
  });

  for await (const chunk of result) {
    yield chunk.text;
  }
};

export const generateTestQuestions = async (topic: string, userProfile?: UserProfile, count: number = 2): Promise<TestQuestion[]> => {
  const prompt = `「${topic}」の4択問題を${count}問、JSON形式で作成してください。解説は短く論理的に記述してください。`;

  const response = await getAIResponse(async (ai) => {
    return await ai.models.generateContent({
      model: MODEL_TEXT,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswerIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING }
            },
            required: ["question", "options", "correctAnswerIndex", "explanation"]
          }
        }
      }
    });
  });

  if (response.text) {
    return JSON.parse(response.text.trim()) as TestQuestion[];
  }
  throw new Error("Failed to generate questions");
};
