//! Numeric tags from ONNX TensorProto.DataType and AttributeProto.AttributeType.
//! Keep wire IDs intact, including unsupported values in inspection output.
pub(super) mod tensor {
    pub const FLOAT: u64 = 1;
    pub const UINT8: u64 = 2;
    pub const INT8: u64 = 3;
    pub const UINT16: u64 = 4;
    pub const INT16: u64 = 5;
    pub const INT32: u64 = 6;
    pub const INT64: u64 = 7;
    pub const BOOL: u64 = 9;
    pub const FLOAT16: u64 = 10;
    pub const DOUBLE: u64 = 11;
    pub const UINT32: u64 = 12;
    pub const UINT64: u64 = 13;
    pub const COMPLEX64: u64 = 14;
    pub const COMPLEX128: u64 = 15;
    pub const BFLOAT16: u64 = 16;
    pub const FLOAT8E4M3FN: u64 = 17;
    pub const FLOAT8E4M3FNUZ: u64 = 18;
    pub const FLOAT8E5M2: u64 = 19;
    pub const FLOAT8E5M2FNUZ: u64 = 20;
    pub const UINT4: u64 = 21;
    pub const INT4: u64 = 22;
    pub const FLOAT4E2M1: u64 = 23;
    pub const FLOAT8E8M0: u64 = 24;
    pub const UINT2: u64 = 25;
    pub const INT2: u64 = 26;

    pub fn bits(data_type: u64) -> Option<u64> {
        match data_type {
            FLOAT | INT32 | UINT32 => Some(32),
            UINT8 | INT8 | BOOL | FLOAT8E4M3FN | FLOAT8E4M3FNUZ | FLOAT8E5M2 | FLOAT8E5M2FNUZ
            | FLOAT8E8M0 => Some(8),
            UINT16 | INT16 | FLOAT16 | BFLOAT16 => Some(16),
            INT64 | DOUBLE | UINT64 | COMPLEX64 => Some(64),
            COMPLEX128 => Some(128),
            UINT4 | INT4 | FLOAT4E2M1 => Some(4),
            UINT2 | INT2 => Some(2),
            _ => None,
        }
    }
}

pub(super) mod attribute {
    pub const FLOAT: u64 = 1;
    pub const INT: u64 = 2;
    pub const STRING: u64 = 3;
    pub const TENSOR: u64 = 4;
    pub const FLOATS: u64 = 6;
    pub const INTS: u64 = 7;
    pub const STRINGS: u64 = 8;
    pub const TENSORS: u64 = 9;
}
