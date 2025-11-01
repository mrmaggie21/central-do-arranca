/**
 * Gerador de CPFs válidos
 * Implementa o algoritmo oficial brasileiro de validação de CPF
 */

class CPFGenerator {
  /**
   * Gera um CPF válido aleatório
   * @returns {string} CPF formatado (XXX.XXX.XXX-XX)
   */
  static generate() {
    // Gera os 9 primeiros dígitos aleatoriamente
    const digits = [];
    for (let i = 0; i < 9; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    
    // Calcula o primeiro dígito verificador
    const firstDigit = this.calculateVerifierDigit(digits);
    digits.push(firstDigit);
    
    // Calcula o segundo dígito verificador
    const secondDigit = this.calculateVerifierDigit(digits);
    digits.push(secondDigit);
    
    // Formata o CPF
    return this.format(digits.join(''));
  }
  
  /**
   * Calcula o dígito verificador
   * @param {number[]} digits - Array com os dígitos
   * @returns {number} Dígito verificador calculado
   */
  static calculateVerifierDigit(digits) {
    let sum = 0;
    let weight = digits.length + 1;
    
    for (let i = 0; i < digits.length; i++) {
      sum += digits[i] * weight;
      weight--;
    }
    
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }
  
  /**
   * Formata um CPF com pontos e hífen
   * @param {string} cpf - CPF sem formatação
   * @returns {string} CPF formatado
   */
  static format(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  
  /**
   * Remove formatação de um CPF
   * @param {string} cpf - CPF formatado
   * @returns {string} CPF sem formatação
   */
  static unformat(cpf) {
    return cpf.replace(/\D/g, '');
  }
  
  /**
   * Valida se um CPF é válido
   * @param {string} cpf - CPF para validar
   * @returns {boolean} True se válido, false caso contrário
   */
  static validate(cpf) {
    const cleanCPF = this.unformat(cpf);
    
    if (cleanCPF.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cleanCPF)) return false; // CPFs com todos os dígitos iguais
    
    const digits = cleanCPF.split('').map(Number);
    
    // Verifica primeiro dígito
    const firstDigit = this.calculateVerifierDigit(digits.slice(0, 9));
    if (firstDigit !== digits[9]) return false;
    
    // Verifica segundo dígito
    const secondDigit = this.calculateVerifierDigit(digits.slice(0, 10));
    if (secondDigit !== digits[10]) return false;
    
    return true;
  }
  
  /**
   * Gera múltiplos CPFs válidos
   * @param {number} count - Quantidade de CPFs a gerar
   * @returns {string[]} Array com CPFs formatados
   */
  static generateMultiple(count) {
    const cpfs = [];
    for (let i = 0; i < count; i++) {
      cpfs.push(this.generate());
    }
    return cpfs;
  }
}

module.exports = CPFGenerator; 
