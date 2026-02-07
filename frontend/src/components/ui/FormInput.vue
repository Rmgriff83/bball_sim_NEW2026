<script setup>
const props = defineProps({
  modelValue: {
    type: [String, Number],
    required: true
  },
  label: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    default: ''
  },
  error: {
    type: String,
    default: ''
  },
  touched: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  required: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'blur'])
</script>

<template>
  <div class="form-group">
    <label class="form-label">
      {{ label }}
      <span v-if="required" class="text-error">*</span>
    </label>
    <input
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="input"
      :class="{ 'is-invalid': touched && error }"
      @input="emit('update:modelValue', $event.target.value)"
      @blur="emit('blur')"
    />
    <p v-if="touched && error" class="input-error">{{ error }}</p>
  </div>
</template>
