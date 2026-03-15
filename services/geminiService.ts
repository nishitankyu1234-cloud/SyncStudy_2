import { GoogleGenAI, Type } from "@google/genai";
import { TestQuestion, UserProfile } from "../types";

// Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_TEXT = 'gemini-3-flash-preview';

/**
 * Creates a chat session and returns a streaming response generator
 * Supports text and optional image input with retry logic
 */
export const createChatStream = async function* (
  history: { role: 'user' | 'model'; parts: { text?: string; inlineData?: any }[] }[],
  newMessage: string,
  imageDataUrl?: string,
  userProfile?: UserProfile
) {
  const maxRetries = 2;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let yielded = false;
    try {
      let systemInstruction = `
あなたは日本トップクラスの予備校講師です。以下の指針に従って生徒を指導してください。

【指導方針】
1. **最高品質の解説**: 難解な概念も、本質を突いた平易な言葉で説明し、論理的かつ構造的に回答してください。
2. **誤字脱字の徹底排除**: 生成されたテキストは送信前に必ず校正し、誤字脱字や不自然な日本語がないようにしてください。
3. **誘導的指導**: すぐに答えを教えるのではなく、ソクラテス式問答法を用いて生徒自身が気付けるように誘導してください。
4. **共通テスト・難関大対応**: 共通テストの傾向（思考力・判断力・表現力）を意識し、単なる暗記ではない「使える知識」を授けてください。

【トーン＆マナー】
*   自信に満ち、頼りがいがあるが、威圧的ではない。
*   生徒のモチベーションを高める、温かみのある「です・ます」調。
*   重要なポイントは箇条書きや太字を適切に使用して視認性を高める。
`;

      if (userProfile) {
        if (userProfile.targetUniversity) {
          systemInstruction += `\n\n【生徒の目標】\n第一志望：${userProfile.targetUniversity}\n${userProfile.targetUniversity}の入試傾向（過去問の特徴、頻出分野、記述の有無など）を熟知したプロフェッショナルとして振る舞ってください。「${userProfile.targetUniversity}ではここが合否を分けます」といった具体的なアドバイスを随所に盛り込んでください。`;
        }

        if (userProfile.major) {
          const majorText = userProfile.major === 'arts' ? '文系' : userProfile.major === 'science' ? '理系' : '';
          if (majorText) {
            systemInstruction += `\n\n【生徒の属性】\nこの生徒は「${majorText}」です。解説のアプローチを最適化してください。\n`;
            if (userProfile.major === 'arts') {
              systemInstruction += `・数学や理科の質問には、数式だけでなく、具体的なイメージや歴史的背景、言語的な比喩を用いて直感的に理解できるよう工夫してください。\n・国語や社会の質問には、背景知識を豊かに広げ、記述力向上につながる指導を意識してください。`;
            } else {
              systemInstruction += `・数学や理科の質問には、論理の飛躍がないよう厳密さを大切にしつつ、応用問題への展開を示唆してください。\n・国語や社会の質問には、論理的構造（因果関係、対比など）を明確にし、効率的に知識を整理できるよう指導してください。`;
            }
          }
        }
      }

      const chat = ai.chats.create({
        model: MODEL_TEXT,
        history: history,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      let messageContent: any = newMessage;

      if (imageDataUrl) {
        const [header, base64Data] = imageDataUrl.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';

        messageContent = [
          { text: newMessage || "この画像について、入試問題としての視点から詳しく解説してください。" },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ];
      }

      const result = await chat.sendMessageStream({ message: messageContent });

      for await (const chunk of result) {
        yielded = true;
        yield chunk.text;
      }
      return; // Success
    } catch (error) {
      if (yielded) throw error; // Don't retry if we already started yielding content
      
      console.error(`Chat attempt ${attempt + 1} failed:`, error);
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Chat stream failed after multiple attempts");
};

/**
 * Generates test questions based on a topic, difficulty, and optional target university
 * Includes retry logic for better reliability
 */
export const generateTestQuestions = async (topic: string, userProfile?: UserProfile, count: number = 3, difficulty: string = 'intermediate'): Promise<TestQuestion[]> => {
  const maxRetries = 2;
  let lastError: any;

  const difficultyMap: Record<string, string> = {
    'beginner': '基礎・基本レベル（教科書レベル）',
    'intermediate': '標準・共通テストレベル',
    'advanced': '応用・難関大入試レベル'
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let prompt = `「${topic}」に関する${difficultyMap[difficulty] || '標準'}の4択問題を作成してください。（全${count}問）`;
      
      if (userProfile) {
        if (userProfile.targetUniversity) {
          prompt += `\n\n【ターゲット：${userProfile.targetUniversity}】\n${userProfile.targetUniversity}の入試傾向を反映させてください。単純な知識問題ではなく、資料読み取りや思考力を問う問題を優先してください。`;
        }
        if (userProfile.major) {
           const majorText = userProfile.major === 'arts' ? '文系' : '理系';
           prompt += `\n\n【生徒属性：${majorText}】\n${majorText}の生徒にとって重要となるポイント（頻出事項や差がつくポイント）を重点的に出題してください。`;
        }
      } else {
        prompt += `\n大学入学共通テストレベルの良問を作成してください。`;
      }
      
      prompt += `\n\n【必須要件】\n・誤字脱字がないか厳重にチェックすること。\n・解説は「なぜその選択肢が正解なのか」「なぜ他の選択肢は間違いなのか」を論理的に説明すること。\n・学習効果の高い問題にすること。`;

      const response = await ai.models.generateContent({
        model: MODEL_TEXT,
        contents: prompt,
        config: {
          systemInstruction: "あなたは日本トップクラスの予備校講師です。指定されたトピックについて、学習効果の高い4択問題を生成してください。出力は必ず指定されたJSON形式に従ってください。問題の質、選択肢の妥当性、解説の詳しさに徹底的にこだわってください。",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING, description: "The test question text, ensure high quality and no typos" },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "An array of 4 possible answers"
                },
                correctAnswerIndex: { type: Type.INTEGER, description: "The index (0-3) of the correct answer" },
                explanation: { type: Type.STRING, description: "Detailed, high-quality explanation. Explain specifically why the answer is correct." }
              },
              required: ["question", "options", "correctAnswerIndex", "explanation"]
            }
          }
        }
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as TestQuestion[];
        }
      }
      throw new Error("Empty or invalid response from AI");
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error);
      lastError = error;
      if (attempt < maxRetries) {
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  throw lastError || new Error("Failed to generate test data after multiple attempts");
};
