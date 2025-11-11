/**
 * Central do Arranca - Rate Limiter Inteligente
 * Gerencia rate limiting com backoff exponencial e retry automático
 */

const Logger = require('./logger');
const configLoader = require('./config-loader');

class RateLimiter {
  constructor(moduleName = 'default') {
    this.moduleName = moduleName;
    this.logger = new Logger(`RATE-LIMITER-${moduleName.toUpperCase()}`);
    this.requestTimestamps = [];
    this.isRateLimited = false;
    this.rateLimitUntil = null;
    this.consecutiveRateLimits = 0;
    this.maxConsecutiveLimits = 5;
    
    // Carrega configuração do módulo
    const apiConfig = configLoader.get(`apis.${moduleName}`) || {};
    this.rateLimitConfig = apiConfig.rateLimit || {
      enabled: true,
      maxRequestsPerMinute: 60,
      retryAfterSeconds: 60
    };
    
    this.maxRequests = this.rateLimitConfig.maxRequestsPerMinute;
    this.windowMs = 60000; // 1 minuto
    this.retryAfterMs = (this.rateLimitConfig.retryAfterSeconds || 60) * 1000;
  }

  /**
   * Verifica se pode fazer requisição
   */
  canMakeRequest() {
    if (!this.rateLimitConfig.enabled) {
      return { allowed: true };
    }

    // Verifica se está bloqueado por rate limit anterior
    if (this.isRateLimited && this.rateLimitUntil) {
      const now = Date.now();
      if (now < this.rateLimitUntil) {
        const waitSeconds = Math.ceil((this.rateLimitUntil - now) / 1000);
        return {
          allowed: false,
          reason: 'rate_limited',
          waitSeconds,
          message: `Rate limit ativo. Aguarde ${waitSeconds}s`
        };
      } else {
        // Bloqueio expirou
        this.isRateLimited = false;
        this.rateLimitUntil = null;
      }
    }

    // Remove timestamps antigos (fora da janela)
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => (now - timestamp) < this.windowMs
    );

    // Verifica se excedeu o limite
    if (this.requestTimestamps.length >= this.maxRequests) {
      const oldestRequest = this.requestTimestamps[0];
      const waitUntil = oldestRequest + this.windowMs;
      const waitSeconds = Math.ceil((waitUntil - now) / 1000);
      
      return {
        allowed: false,
        reason: 'quota_exceeded',
        waitSeconds,
        message: `Limite de ${this.maxRequests} requisições/min atingido. Aguarde ${waitSeconds}s`
      };
    }

    return { allowed: true };
  }

  /**
   * Registra uma requisição
   */
  recordRequest() {
    if (!this.rateLimitConfig.enabled) return;
    
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Registra que recebeu rate limit da API
   */
  async handleRateLimit(responseTime = null) {
    this.consecutiveRateLimits++;
    this.isRateLimited = true;
    
    // Backoff exponencial: aumenta tempo de espera a cada rate limit consecutivo
    const baseWait = this.retryAfterMs;
    const backoffMultiplier = Math.min(
      Math.pow(2, this.consecutiveRateLimits - 1),
      8 // Máximo 8x o tempo base
    );
    const waitTime = baseWait * backoffMultiplier;
    
    this.rateLimitUntil = Date.now() + waitTime;
    
    const waitMinutes = Math.ceil(waitTime / 60000);
    
    await this.logger.warn('Rate limit detectado', {
      module: this.moduleName,
      consecutiveCount: this.consecutiveRateLimits,
      waitMinutes,
      waitMs: waitTime,
      backoffMultiplier
    });

    // Se muitos rate limits consecutivos, aumenta delay
    if (this.consecutiveRateLimits >= this.maxConsecutiveLimits) {
      await this.logger.warn('Muitos rate limits consecutivos. Aumentando delay padrão', {
        module: this.moduleName,
        count: this.consecutiveRateLimits
      });
    }

    return {
      waitTime,
      waitSeconds: Math.ceil(waitTime / 1000),
      waitMinutes,
      backoffMultiplier
    };
  }

  /**
   * Registra requisição bem-sucedida (reseta contador de rate limits)
   */
  recordSuccess() {
    // Sucesso reseta contador de rate limits consecutivos
    if (this.consecutiveRateLimits > 0) {
      this.consecutiveRateLimits = Math.max(0, this.consecutiveRateLimits - 1);
    }
  }

  /**
   * Aguarda tempo necessário antes de fazer requisição
   */
  async waitIfNeeded() {
    const check = this.canMakeRequest();
    
    if (!check.allowed && check.waitSeconds) {
      await this.logger.info('Aguardando rate limit', {
        module: this.moduleName,
        waitSeconds: check.waitSeconds,
        reason: check.reason
      });
      
      await this.sleep(check.waitSeconds * 1000);
    }
  }

  /**
   * Obtém estatísticas do rate limiter
   */
  getStats() {
    const now = Date.now();
    const recentRequests = this.requestTimestamps.filter(
      timestamp => (now - timestamp) < this.windowMs
    ).length;
    
    return {
      recentRequests,
      maxRequests: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - recentRequests),
      isRateLimited: this.isRateLimited,
      rateLimitUntil: this.rateLimitUntil,
      waitSeconds: this.isRateLimited && this.rateLimitUntil
        ? Math.ceil((this.rateLimitUntil - now) / 1000)
        : 0,
      consecutiveRateLimits: this.consecutiveRateLimits
    };
  }

  /**
   * Reseta rate limiter
   */
  reset() {
    this.requestTimestamps = [];
    this.isRateLimited = false;
    this.rateLimitUntil = null;
    this.consecutiveRateLimits = 0;
  }

  /**
   * Helper: sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RateLimiter;

